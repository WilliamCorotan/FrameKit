import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

export function loadLocalEnvironment(file = new URL("../.env", import.meta.url)) {
  if (!process.env.CI && existsSync(file)) loadEnvFile(file);
}

export function requireDatabaseUrl(env = process.env) {
  if (!env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required. Configure GitHub environment secrets for CI or the root .env for local commands.");
  try {
    const parts = env.DATABASE_URL.match(/^(postgres(?:ql)?:\/\/)([^/?#]+)(\/[^?#]+)(?:[?#].*)?$/);
    if (!parts) throw new Error();
    const authority = parts[2];
    const credentialsEnd = authority.lastIndexOf("@") + 1;
    const credentials = authority.slice(0, credentialsEnd);
    for (const host of authority.slice(credentialsEnd).split(",")) {
      const url = new URL(parts[1] + credentials + host + parts[3]);
      if (!host || !url.hostname || url.pathname.length <= 1) throw new Error();
    }
  } catch { throw new Error("DATABASE_URL must be a PostgreSQL URL with an explicit host and database name."); }
  return env.DATABASE_URL;
}
