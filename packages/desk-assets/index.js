import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
export function deskAssetsDirectory() { return join(dirname(fileURLToPath(import.meta.url)), "assets"); }
