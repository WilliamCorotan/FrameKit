import { access, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { deskAssetsDirectory } from "@framekit/desk-assets";
import { framekitVersion, scaffoldOptions, writeScaffold, type ScaffoldFile } from "./paths.js";

export async function installDesk(target: string, args: string[], log: (message: string) => void): Promise<void> {
  const destination = resolve(target);
  const source = deskAssetsDirectory();
  const files: ScaffoldFile[] = [];
  async function collect(directory: string, relative = ""): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relativePath = join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Desk assets must not contain symbolic links.");
      if (entry.isDirectory()) await collect(path, relativePath);
      else if (entry.isFile() && relativePath !== "framekit-config.js") files.push({ path: join(destination, relativePath), content: await readFile(path) });
    }
  }
  await collect(source);
  const apiFlag = args.indexOf("--api-url");
  const apiUrl = apiFlag < 0 ? undefined : args[apiFlag + 1];
  if (apiFlag >= 0 && (!apiUrl || apiUrl.startsWith("--"))) throw new Error("--api-url requires an HTTP(S) URL.");
  if (apiUrl) {
    let parsed: URL;
    try { parsed = new URL(apiUrl); } catch { throw new Error("Invalid Desk API URL."); }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Desk API URL must use HTTP(S) without credentials.");
  }
  const configPath = join(destination, "framekit-config.js");
  const exists = await access(configPath).then(() => true, () => false);
  if (!exists || apiUrl) files.push({ path: configPath, content: `window.__FRAMEKIT_CONFIG__ = ${JSON.stringify({ version: 1, ...(apiUrl ? { apiUrl } : {}) })};\n` });
  files.push({ path: join(destination, "framekit-desk-version.json"), content: JSON.stringify({ version: await framekitVersion(), configurationVersion: 1 }, null, 2) + "\n" });
  await writeScaffold(files, scaffoldOptions(args.filter((_, index) => apiFlag < 0 || (index !== apiFlag && index !== apiFlag + 1))), log);
  log(`${args.includes("--dry-run") ? "Would install" : "Installed"} Desk at ${target}; serve this directory with a trailing slash. Existing runtime configuration is preserved unless --api-url is supplied.`);
}
