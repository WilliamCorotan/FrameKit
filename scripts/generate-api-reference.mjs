import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { publicPackages } from "./public-packages.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const configuration = ts.readConfigFile(resolve(root, "tsconfig.check.json"), ts.sys.readFile);
if (configuration.error) throw new Error(ts.flattenDiagnosticMessageText(configuration.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(configuration.config, ts.sys, root);
const entries = await Promise.all(publicPackages.map(async (item) => {
  const manifest = JSON.parse(await readFile(resolve(root, "packages", item.directory, "package.json"), "utf8"));
  return { ...item, entry: resolve(root, "packages", item.directory, manifest.exports["."].development.types) };
}));
const program = ts.createProgram(entries.map((item) => item.entry), parsed.options);
const checker = program.getTypeChecker();
const lines = ["# Public API reference", "", "Generated from the public TypeScript entry points by `pnpm docs:api`. This index links each public symbol to its defining source; function and constructor signatures are included where available. Package exports and their declaration files remain the complete type contract. Regenerate after changing public APIs.", ""];
for (const entry of entries) {
  const source = program.getSourceFile(entry.entry);
  const module = source && checker.getSymbolAtLocation(source);
  if (!module) throw new Error(`Cannot resolve ${entry.name}`);
  lines.push(`## ${entry.name}`, "");
  for (const exported of checker.getExportsOfModule(module).sort((a, b) => a.name.localeCompare(b.name))) {
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!declaration) continue;
    const file = declaration.getSourceFile();
    const path = relative(resolve(root, "docs"), file.fileName).replaceAll("\\", "/");
    const line = file.getLineAndCharacterOfPosition(declaration.getStart()).line + 1;
    lines.push(`### ${exported.name}`, "", `[Source](${path}#L${line})`, "");
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    const signatures = [...type.getCallSignatures(), ...type.getConstructSignatures()];
    if (signatures.length) {
      lines.push("```ts", ...signatures.map((signature) => `${exported.name}${checker.signatureToString(signature, declaration, ts.TypeFormatFlags.NoTruncation)}`), "```", "");
    } else {
      lines.push(ts.isTypeAliasDeclaration(declaration) ? "Type alias." : ts.isInterfaceDeclaration(declaration) ? "Interface." : "Exported value or type.", "");
    }
    const documentation = ts.displayPartsToString(symbol.getDocumentationComment(checker));
    if (documentation) lines.push(documentation, "");
  }
}
await writeFile(resolve(root, "docs/api-reference.md"), lines.join("\n"));
console.log(`Generated public API reference for ${entries.length} packages.`);
