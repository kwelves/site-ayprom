import { spawn, type ChildProcess } from "node:child_process";
import { ProducerError } from "./errors";
import type { ChildServerSpec, ChildStopResult, StartChildServer } from "./types";

// Environment keys the child may inherit. Node on Windows needs SYSTEMROOT
// and a temp directory to work at all; PATH lets a plain command name resolve.
// Everything else — including every Supabase, Cloudflare, admin or Sentry
// variable of the producer's own process — stays out of the child.
const INHERITED_ENV_KEYS = [
  "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT",
  "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LANG", "LC_ALL",
];
const STDOUT_BUFFER_LIMIT = 64 * 1024;
const READY_PROBE_INTERVAL_MS = 100;
const READY_PROBE_ATTEMPT_TIMEOUT_MS = 1_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

interface ChildExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Spawns the server process (shell: false, argument array, windowsHide) and
 * resolves once it printed a loopback base URL matching `readyPattern` and
 * answers HTTP 200 on the probe path. Any failure before readiness kills the
 * child and rejects with a `next_start_failed` ProducerError.
 */
export const startChildServer: StartChildServer = async (spec, options) => {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    // The repository augments ProcessEnv with required app keys; the child
    // deliberately receives only the allowlisted subset, hence the cast.
    env: buildChildEnv(spec.env) as NodeJS.ProcessEnv,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const exitState: { done: boolean; exit: ChildExit | null } = { done: false, exit: null };
  const exited = new Promise<ChildExit>((resolve) => {
    child.once("exit", (exitCode, signal) => {
      exitState.done = true;
      exitState.exit = { exitCode, signal };
      resolve(exitState.exit);
    });
  });
  // Drain stderr so the child never blocks on a full pipe; content is discarded.
  child.stderr?.resume();

  const stop = (stopOptions: { timeoutMs: number }) => stopChild(child, exitState, exited, stopOptions.timeoutMs);

  try {
    const baseUrl = await waitForReadyUrl(child, exited, spec, options);
    await waitForProbe(baseUrl, spec.readyProbePath ?? "/", exited, options);
    return { baseUrl, pid: child.pid ?? 0, stop };
  } catch (error) {
    await stop({ timeoutMs: Math.min(options.launchTimeoutMs, 5_000) });
    if (error instanceof ProducerError) error.childPid = child.pid ?? null;
    throw error;
  }
};

function waitForReadyUrl(
  child: ChildProcess,
  exited: Promise<ChildExit>,
  spec: ChildServerSpec,
  options: { launchTimeoutMs: number; signal?: AbortSignal },
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let stdoutTail = "";
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(launchTimer);
      options.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(new ProducerError("next_start_failed", "aborted")));
    const launchTimer = setTimeout(
      () => finish(() => reject(new ProducerError("next_start_failed", "readiness_timeout"))),
      options.launchTimeoutMs,
    );

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.once("error", (error) => {
      finish(() => reject(new ProducerError("next_start_failed", "spawn_failed", {
        issues: [{ field: "server.command", rule: (error as NodeJS.ErrnoException).code ?? "spawn_error" }],
      })));
    });
    void exited.then((exit) => {
      finish(() => reject(new ProducerError("next_start_failed", "child_exited_early", { exitCode: exit.exitCode })));
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (settled) return;
      stdoutTail = (stdoutTail + chunk).slice(-STDOUT_BUFFER_LIMIT);
      const match = spec.readyPattern.exec(stdoutTail);
      if (!match?.[1]) return;
      const baseUrl = normalizeLoopbackOrigin(match[1]);
      if (!baseUrl) {
        finish(() => reject(new ProducerError("next_start_failed", "ready_url_not_loopback")));
        return;
      }
      finish(() => resolve(baseUrl));
    });
  });
}

async function waitForProbe(
  baseUrl: string,
  probePath: string,
  exited: Promise<ChildExit>,
  options: { launchTimeoutMs: number; signal?: AbortSignal },
): Promise<void> {
  const deadline = Date.now() + options.launchTimeoutMs;
  const holder: { exit: ChildExit | null } = { exit: null };
  void exited.then((value) => { holder.exit = value; });
  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new ProducerError("next_start_failed", "aborted");
    if (holder.exit) throw new ProducerError("next_start_failed", "child_exited_early", { exitCode: holder.exit.exitCode });
    try {
      const response = await fetch(`${baseUrl}${probePath}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(READY_PROBE_ATTEMPT_TIMEOUT_MS),
      });
      await response.body?.cancel();
      if (response.status === 200) return;
    } catch {
      // Not listening yet; keep polling until the launch deadline.
    }
    await sleep(READY_PROBE_INTERVAL_MS);
  }
  throw new ProducerError("next_start_failed", "readiness_timeout");
}

async function stopChild(
  child: ChildProcess,
  exitState: { done: boolean; exit: ChildExit | null },
  exited: Promise<ChildExit>,
  timeoutMs: number,
): Promise<ChildStopResult> {
  if (exitState.done && exitState.exit) {
    return { ok: true, exitCode: exitState.exit.exitCode, signal: exitState.exit.signal, alreadyExited: true };
  }
  const pid = child.pid;
  if (!pid) return { ok: false, reason: "kill_failed" };

  try {
    if (process.platform === "win32") {
      // TerminateProcess has no graceful form; /T covers the child's own tree only.
      await runTaskkill(pid);
      if (!exitState.done) child.kill();
    } else {
      signalGroup(child, pid, "SIGTERM");
      const graceful = await withTimeout(exited, Math.max(1, Math.floor(timeoutMs / 2)));
      if (!graceful) signalGroup(child, pid, "SIGKILL");
    }
  } catch {
    if (!exitState.done) return { ok: false, reason: "kill_failed" };
  }

  const exit = await withTimeout(exited, timeoutMs);
  if (!exit) return { ok: false, reason: "child_stop_timeout" };
  return { ok: true, exitCode: exit.exitCode, signal: exit.signal, alreadyExited: false };
}

// Resolves with the promise's value or null after `ms`. The timer is cleared
// as soon as the promise settles so a finished run never keeps the event loop
// (and the CLI process) alive for the full timeout.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    void promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

function signalGroup(child: ChildProcess, pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {
    child.kill(signal);
  }
}

function runTaskkill(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    killer.once("error", () => resolve());
    killer.once("exit", () => resolve());
  });
}

function buildChildEnv(explicit: Record<string, string> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV_KEYS) {
    const value = lookupEnv(key);
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...explicit };
}

function lookupEnv(key: string): string | undefined {
  if (process.platform !== "win32") return process.env[key];
  const match = Object.keys(process.env).find((candidate) => candidate.toUpperCase() === key);
  return match ? process.env[match] : undefined;
}

function normalizeLoopbackOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
