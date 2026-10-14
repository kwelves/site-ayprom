import os from "node:os";
import path from "node:path";

export const PROPERTY = "sc-domain:ayprom-gidravlika.kg";

export function loadConfig(env = process.env) {
  const defaultBase = env.LOCALAPPDATA
    ? path.join(env.LOCALAPPDATA, "AYPROM", "search-console-mcp")
    : path.join(os.homedir(), ".config", "AYPROM", "search-console-mcp");
  const configDir = path.resolve(env.AYPROM_GSC_CONFIG_DIR || defaultBase);

  return Object.freeze({
    property: PROPERTY,
    rootDomain: "ayprom-gidravlika.kg",
    scope: "https://www.googleapis.com/auth/webmasters",
    configDir,
    oauthClientPath: path.join(configDir, "oauth-client.json"),
    tokenPath: path.join(configDir, "tokens.json"),
    auditPath: path.join(configDir, "audit.jsonl"),
  });
}
