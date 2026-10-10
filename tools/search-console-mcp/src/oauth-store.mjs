import fs from "node:fs/promises";

const DEFAULT_AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

export function parseOAuthClient(value) {
  const source = value?.installed;
  if (!source?.client_id) {
    throw new Error("Google OAuth desktop credentials are missing client_id.");
  }
  if (!source?.client_secret) {
    throw new Error("Google OAuth desktop credentials are missing client_secret.");
  }

  return {
    clientId: source.client_id,
    clientSecret: source.client_secret,
    authUri: source.auth_uri || DEFAULT_AUTH_URI,
    tokenUri: source.token_uri || DEFAULT_TOKEN_URI,
  };
}

async function readJson(filePath, missingMessage) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(missingMessage);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${filePath}.`);
    }
    throw error;
  }
}

export async function loadOAuthClient(config) {
  const value = await readJson(
    config.oauthClientPath,
    `OAuth client file is missing at ${config.oauthClientPath}.`,
  );
  return parseOAuthClient(value);
}

export async function loadToken(config) {
  return readJson(
    config.tokenPath,
    `Search Console token is missing. Run npm run auth in the plugin directory.`,
  );
}

export async function saveToken(config, token) {
  await fs.mkdir(config.configDir, { recursive: true });
  await fs.writeFile(config.tokenPath, `${JSON.stringify(token, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
