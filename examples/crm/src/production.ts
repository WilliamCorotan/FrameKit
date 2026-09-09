import { configuredDatabaseUrl } from "./database.js";
import { createAesGcmSettingsSecrets, decodeSecretKey } from "@framekit/storage";

export function productionConfiguration(env: NodeJS.ProcessEnv) {
  const production = env.NODE_ENV === "production";
  const databaseUrl = configuredDatabaseUrl(env);
  const poolMax = integer(env.FRAMEKIT_DB_POOL_MAX, 10, "FRAMEKIT_DB_POOL_MAX");
  if (poolMax < 2) throw new Error("FRAMEKIT_DB_POOL_MAX must be at least two for raw and ORM codec profiles.");
  const connectionBudget = integer(env.FRAMEKIT_DB_CONNECTION_BUDGET, poolMax + 1, "FRAMEKIT_DB_CONNECTION_BUDGET");
  if (connectionBudget < poolMax + 1) throw new Error("Database budget must cover the query pool and one realtime listener.");
  const activeKeyId = env.FRAMEKIT_SETTINGS_ACTIVE_KEY;
  const encodedKeys = env.FRAMEKIT_SETTINGS_KEYS;
  if (production && (!activeKeyId || !encodedKeys)) throw new Error("Production requires FRAMEKIT_SETTINGS_ACTIVE_KEY and FRAMEKIT_SETTINGS_KEYS.");
  let settingsSecrets;
  if (activeKeyId || encodedKeys) {
    if (!activeKeyId || !encodedKeys) throw new Error("Settings active key and keyring must be configured together.");
    try {
      const parsed: unknown = JSON.parse(encodedKeys);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      const keys = Object.fromEntries(Object.entries(parsed).map(([id, value]) => {
        if (typeof value !== "string") throw new Error();
        return [id, decodeSecretKey(value)];
      }));
      settingsSecrets = createAesGcmSettingsSecrets({ activeKeyId, keys });
    } catch { throw new Error("Invalid settings encryption keyring configuration."); }
  }
  const bucket = env.FRAMEKIT_S3_BUCKET;
  const region = env.AWS_REGION;
  const endpoint = env.FRAMEKIT_S3_ENDPOINT;
  if (production && (!bucket || !region)) throw new Error("Production requires FRAMEKIT_S3_BUCKET and AWS_REGION.");
  if (bucket && (!databaseUrl || !region)) throw new Error("S3 attachments require DATABASE_URL and AWS_REGION.");
  if (endpoint) {
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new Error("Invalid S3 endpoint configuration."); }
    if (url.username || url.password || !["https:", "http:"].includes(url.protocol) || (production && url.protocol !== "https:")) throw new Error("S3 endpoint must use HTTPS in production and cannot contain credentials.");
    if (!bucket) throw new Error("S3 endpoint requires a bucket.");
  }
  return { production, databaseUrl, poolMax, connectionBudget, settingsSecrets, bucket, region, endpoint };
}

function integer(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${name} must be a positive integer.`);
  return Number(value);
}
