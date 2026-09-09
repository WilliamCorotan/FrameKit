import { installDesk } from "./desk.js";
import { applyMigration, createApp, generateMigration, generateSdk, newDocType, newModule, rollbackMigration } from "./commands.js";

export async function runCli(argv = process.argv.slice(2), io: { stdout?: Pick<NodeJS.WriteStream, "write">; log?: (message: string) => void } = {}): Promise<void> {
  const [command, name, ...args] = argv;
  const stdout = io.stdout ?? process.stdout;
  const log = io.log ?? console.log;
  if (!command || command === "help") { printHelp(log); return; }
  if (!name) throw new Error(`Missing name for command "${command}"`);
  if (command === "install-desk") return installDesk(name, args, log);
  if (command === "new-module") return newModule(name, args, log);
  if (command === "new-doctype") return newDocType(name, args, log);
  if (command === "create-app") return createApp(name, args, log);
  if (command === "generate-sdk") return generateSdk(name, args, stdout, log);
  if (command === "generate-migration") return generateMigration(name, args, stdout, log);
  if (command === "apply-migration" || command === "replay-migration") return applyMigration(name, args, log);
  if (command === "rollback-migration") return rollbackMigration(name, args, log);
  throw new Error(`Unknown command "${command}"`);
}

function printHelp(log: (message: string) => void): void {
  log("framekit commands:\n  install-desk <directory> [--api-url URL] [--dry-run] [--force]\\n  create-app <name> [--desk] [--dry-run] [--force]\\n  new-module <name> [--dry-run] [--force]\\n  new-doctype <name> [--dry-run] [--force]\\n  generate-sdk <module-path> [--out file]\\n  generate-migration <current-module-path> <next-module-path> [--format ts|json|sql] [--out file]\\n  apply-migration <migration-module-path> --tenant-id id --app-name name [--database-url url] [--allow-destructive]\\n  replay-migration <migration-module-path> --tenant-id id --app-name name [--database-url url] [--allow-destructive]\\n  rollback-migration <migration-module-path> --tenant-id id --app-name name [--database-url url] [--allow-destructive] [--id id]");
}

