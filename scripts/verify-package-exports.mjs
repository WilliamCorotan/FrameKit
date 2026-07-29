#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publicPackageDirectories } from "./public-packages.mjs";
import ts from "typescript";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const supportsDevelopmentImports = process.allowedNodeEnvironmentFlags.has("--conditions");
if (!supportsDevelopmentImports) {
  throw new Error("Package export verification requires Node support for --conditions.");
}

function importedSymbols(packageRoot, packageName, development = false) {
  const arguments_ = ["--input-type=module"];
  if (development) arguments_.push("--import", "tsx", "--conditions=development");
  arguments_.push("--eval", `const exports = await import(${JSON.stringify(packageName)}); process.stdout.write(JSON.stringify(Object.keys(exports).sort()))`);
  return JSON.parse(execFileSync(process.execPath, arguments_, { cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

function exportedTypeSymbols(packageRoot, packageName, development = false) {
  const compilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2023,
    customConditions: development ? ["development"] : [],
    types: ["node"],
    noEmit: true,
    skipLibCheck: true,
    strict: true
  };
  const containingFile = join(packageRoot, "verify-package-exports.ts");
  const resolvedModule = ts.resolveModuleName(packageName, containingFile, compilerOptions, ts.sys).resolvedModule;
  if (!resolvedModule) throw new Error(`${packageName} could not resolve its ${development ? "development" : "default"} type export.`);
  const program = ts.createProgram({ rootNames: [resolvedModule.resolvedFileName], options: compilerOptions });
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (diagnostics.length > 0) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, ts.createCompilerHost(compilerOptions)));
  const sourceFile = program.getSourceFile(resolvedModule.resolvedFileName);
  const moduleSymbol = sourceFile && program.getTypeChecker().getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) throw new Error(`${packageName} did not expose a type module symbol.`);
  return { path: resolvedModule.resolvedFileName, symbols: program.getTypeChecker().getExportsOfModule(moduleSymbol).map((symbol) => symbol.name).sort() };
}

for (const directory of publicPackageDirectories) {
  const packageRoot = join(root, "packages", directory);
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  if (manifest.private) throw new Error(`${manifest.name} unexpectedly became private.`);
  if (manifest.engines?.node !== ">=22 <26") throw new Error(`${manifest.name} must declare the supported Node range.`);
  for (const relativePath of [manifest.main, manifest.types, manifest.exports?.["."]?.import, manifest.exports?.["."]?.types, manifest.exports?.["."]?.development?.types, manifest.exports?.["."]?.development?.default]) {
    if (typeof relativePath !== "string") throw new Error(`${manifest.name} has an incomplete root export contract.`);
    await access(join(packageRoot, relativePath));
  }
  const defaultSymbols = importedSymbols(packageRoot, manifest.name);
  const developmentSymbols = importedSymbols(packageRoot, manifest.name, true);
  if (JSON.stringify(defaultSymbols) !== JSON.stringify(developmentSymbols)) {
    throw new Error(`${manifest.name} exports different symbols for default and development conditions.`);
  }
  const defaultTypes = exportedTypeSymbols(packageRoot, manifest.name);
  const developmentTypes = exportedTypeSymbols(packageRoot, manifest.name, true);
  if (defaultTypes.path !== resolve(packageRoot, manifest.exports["."].types)) throw new Error(`${manifest.name} default type export resolved to an unexpected file.`);
  if (developmentTypes.path !== resolve(packageRoot, manifest.exports["."].development.types)) throw new Error(`${manifest.name} development type export resolved to an unexpected file.`);
  if (JSON.stringify(defaultTypes.symbols) !== JSON.stringify(developmentTypes.symbols)) {
    throw new Error(`${manifest.name} exports different type symbols for default and development conditions.`);
  }
  process.stdout.write(`verified ${manifest.name}@${manifest.version}\n`);
}
