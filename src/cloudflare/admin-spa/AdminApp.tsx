import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import ProtectedAdminLayout from "@/app/admin/(protected)/layout";
import AdminLoading from "@/app/admin/(protected)/loading";
import AdminError from "@/app/admin/(protected)/error";
import { rpc } from "./runtime";
import { AdminNotFoundError } from "./rpc-client";
import { getLocation, refresh, navigate, setPrefetcher, useLocation } from "./router";
import { buildRouteTable, matchRoute, resolveServerTree, type RouteMatch } from "./routes";
import { ParamsProvider } from "./shims/navigation";
import { isNotFoundError, readRedirectTarget } from "../admin-worker/shims/next-navigation";

interface PageModule {
  default: (props: unknown) => Promise<ReactNode> | ReactNode;
  metadata?: { title?: string | { default?: string; absolute?: string } };
  generateMetadata?: (props: unknown) => Promise<PageModule["metadata"]> | PageModule["metadata"];
}

const pageLoaders = import.meta.glob("../../app/admin/**/page.tsx") as Record<string, () => Promise<PageModule>>;
const routeTable = buildRouteTable(Object.keys(pageLoaders));
// Design system v2: a placeholder never flashes for an answer faster than 300ms.
const LOADING_AFTER_MS = 300;
const PREFETCH_COOLDOWN_MS = 3000;

function queryObject(search: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    const existing = result[key];
    result[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return result;
}

function titleOf(metadata: PageModule["metadata"]): string | undefined {
  const title = metadata?.title;
  return typeof title === "string" ? title : (title?.absolute ?? title?.default);
}

// Runs the same page function the Next server ran; every `await getAdminX()` inside it is answered
// from the browser's memory when the page was seen before.
async function renderPage(match: RouteMatch, search: string): Promise<{ node: ReactNode; title?: string }> {
  const page = await pageLoaders[match.route.file]();
  const props = { params: Promise.resolve(match.params), searchParams: Promise.resolve(queryObject(search)) };
  const metadata = page.generateMetadata ? await page.generateMetadata(props) : page.metadata;
  // A page is a server component: call it directly (so its redirect() and notFound() surface here),
  // then resolve any async components inside the tree it returned.
  const node = await resolveServerTree(await page.default(props));
  return { node, title: titleOf(metadata) };
}

class PageBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Admin route error", error, info.componentStack); }
  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <AdminError error={this.state.error} unstable_retry={() => { this.setState({ error: null }); refresh(); }} />;
  }
}

function NotFoundView() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-xl font-semibold text-foreground">Страница не найдена</h1>
      <p className="mt-2 text-sm text-muted-foreground">Такой страницы в админке нет или запись уже удалена.</p>
      <a href="/admin/products" className="mt-6 inline-block text-sm font-medium text-primary">К товарам</a>
    </div>
  );
}

type View = { key: string; protected: boolean; params: Record<string, string>; node: ReactNode };

export function AdminApp() {
  const location = useLocation();
  const [view, setView] = useState<View | null>(null);
  const [loading, setLoading] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const lastPath = useRef<string | null>(null);
  const prefetched = useRef(new Map<string, number>());

  useEffect(() => rpc.subscribe(() => setDataVersion((value) => value + 1)), []);

  useEffect(() => {
    setPrefetcher((url) => {
      const target = new URL(url, window.location.origin);
      const match = matchRoute(routeTable, target.pathname);
      if (!match?.route.protected) return;
      const key = `${target.pathname}${target.search}`;
      const last = prefetched.current.get(key) ?? 0;
      if (Date.now() - last < PREFETCH_COOLDOWN_MS) return;
      prefetched.current.set(key, Date.now());
      void renderPage(match, target.search).catch(() => undefined);
    });
    return () => setPrefetcher(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const movedToNewPage = lastPath.current !== location.pathname;
    lastPath.current = location.pathname;
    const timer = movedToNewPage ? window.setTimeout(() => !cancelled && setLoading(true), LOADING_AFTER_MS) : undefined;
    void (async () => {
      const match = matchRoute(routeTable, location.pathname);
      let next: View;
      try {
        if (!match) throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
        const { node, title } = await renderPage(match, location.search);
        if (title) document.title = title;
        next = { key: location.pathname, protected: match.route.protected, params: match.params, node };
      } catch (error) {
        const target = readRedirectTarget(error);
        if (target) { if (!cancelled) navigate(target, { replace: true }); return; }
        if (error instanceof Error && error.message === "unauthorized") return;
        const inProtected = match?.route.protected ?? true;
        const node = isNotFoundError(error) || error instanceof AdminNotFoundError
          ? <NotFoundView />
          : <AdminError error={error as Error} unstable_retry={refresh} />;
        next = { key: location.pathname, protected: inProtected, params: match?.params ?? {}, node };
      }
      if (cancelled) return;
      window.clearTimeout(timer);
      setLoading(false);
      setView(next);
    })();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [location.pathname, location.search, location.refreshTick, dataVersion]);

  // Warm the main sections once the first page is shown, so the first click is already instant.
  useEffect(() => {
    if (!view?.protected) return;
    const handle = window.setTimeout(() => {
      for (const route of routeTable) {
        if (route.protected && !route.pattern.includes(":") && !route.pattern.endsWith("/new") && route.pattern !== getLocation().pathname) {
          const match = matchRoute(routeTable, route.pattern);
          if (match) void renderPage(match, "").catch(() => undefined);
        }
      }
    }, 600);
    return () => window.clearTimeout(handle);
  }, [view?.protected]);

  if (!view) return null;
  const content = (
    <PageBoundary resetKey={view.key}>
      {/* Stretches like the page it holds (the login screen centres itself in the full height) and plays the
          screen entrance once per page: the key changes, the element is new. */}
      <div key={view.key} data-admin-screen className="flex min-h-0 flex-1 flex-col">
        {loading ? <AdminLoading /> : view.node}
      </div>
    </PageBoundary>
  );
  return (
    <ParamsProvider params={view.params}>
      {view.protected ? <ProtectedAdminLayout>{content}</ProtectedAdminLayout> : content}
    </ParamsProvider>
  );
}
