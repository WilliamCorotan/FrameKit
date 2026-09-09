export function configuredDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.FRAMEKIT_TEST_MEMORY_STORAGE === "true") {
    if (env.NODE_ENV !== "test") throw new Error("FRAMEKIT_TEST_MEMORY_STORAGE is only allowed in tests.");
    return undefined;
  }
  if (!env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required. Configure it in the root .env locally or the deployment environment.");
  try {
    const parts = env.DATABASE_URL.match(/^(postgres(?:ql)?:\/\/)([^/?#]+)(\/[^?#]+)(?:[?#].*)?$/);
    if (!parts) throw new Error();
    const authority = parts[2]!;
    const credentialsEnd = authority.lastIndexOf("@") + 1;
    const credentials = authority.slice(0, credentialsEnd);
    for (const host of authority.slice(credentialsEnd).split(",")) {
      const url = new URL(parts[1] + credentials + host + parts[3]);
      if (!host || !url.hostname || url.pathname.length <= 1) throw new Error();
    }
  } catch { throw new Error("DATABASE_URL must specify a PostgreSQL host and database name."); }
  return env.DATABASE_URL;
}
