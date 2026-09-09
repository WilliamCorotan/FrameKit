import { spawn } from "node:child_process";
import { loadLocalEnvironment, requireDatabaseUrl } from "./environment.mjs";

loadLocalEnvironment();
const args = process.argv.slice(2);
if (args[0] === "--database") { args.shift(); requireDatabaseUrl(); }
if (args.length) {
  const child = spawn(args[0], args.slice(1), { stdio: "inherit", env: process.env });
  child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
  child.once("exit", (code) => { process.exitCode = code ?? 1; });
}
