import { constants, realpathSync } from "node:fs";
import { access, lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type ScaffoldOptions = {
  dryRun: boolean;
  force: boolean;
};

export type ScaffoldFile = {
  path: string;
  content: string | Uint8Array;
};


export function scaffoldOptions(args: string[]): ScaffoldOptions {
  const unknown = args.filter((arg) => arg !== "--dry-run" && arg !== "--force");
  if (unknown.length > 0) {
    throw new Error(`Unknown scaffold option${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
  }
  return { dryRun: args.includes("--dry-run"), force: args.includes("--force") };
}

export async function writeScaffold(files: ScaffoldFile[], options: ScaffoldOptions, log: (message: string) => void): Promise<void> {
  const root = realpathSync(process.cwd());
  const existing: string[] = [];
  for (const file of files) {
    await assertSafeScaffoldPath(root, file.path);
    if (await pathExists(file.path)) {
      existing.push(file.path);
    }
  }
  if (existing.length > 0 && !options.force) {
    throw new Error(`Refusing to overwrite existing scaffold files:\n${existing.map((path) => `- ${path}`).join("\n")}\nRe-run with --force to replace only these generated paths.`);
  }
  for (const file of files) {
    const action = existing.includes(file.path) ? "overwrite" : "create";
    if (options.dryRun) {
      log(`Would ${action} ${file.path}`);
      continue;
    }
    await mkdir(dirname(file.path), { recursive: true });
    await assertSafeScaffoldPath(root, file.path);
    const handle = await open(file.path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o666);
    try {
      await handle.writeFile(file.content);
    } finally {
      await handle.close();
    }
  }
}

export async function assertSafeScaffoldPath(root: string, candidate: string): Promise<void> {
  const absolute = resolve(candidate);
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    throw new Error(`Refusing scaffold path outside the current directory: ${candidate}`);
  }
  const components = relative(root, absolute).split(sep).filter(Boolean);
  let current = root;
  for (const component of components) {
    current = join(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Refusing scaffold path containing a symbolic link: ${candidate}`);
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function framekitVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { version?: unknown };
  if (!isValidSemVer(manifest.version)) {
    throw new Error("@framekit/cli package version is not valid semver.");
  }
  return manifest.version;
}

export function isValidSemVer(value: unknown): value is string {
  return typeof value === "string"
    && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.test(value);
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function slug(value: string): string {
  const result = value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
  if (!result) {
    throw new Error("Scaffold name must contain at least one letter or number.");
  }
  return result;
}

export function camel(value: string): string {
  return value.replaceAll(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()).replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

export function title(value: string): string {
  return value.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

export function pathToImportSpecifier(value: string): string {
  if (value.startsWith("file:")) {
    return value;
  }
  if (value.startsWith(".") || value.startsWith("/") || value.endsWith(".ts") || value.endsWith(".js") || value.includes("/")) {
    return pathToFileURL(isAbsolute(value) ? value : resolve(process.cwd(), value)).href;
  }
  return `./${value}`;
}
