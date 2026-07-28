import { z } from "zod";
import { AppSchema, CommandDefinitionSchema, DocTypeSchema, ModuleSchema, SettingDefinitionSchema, type AppDefinition, type DocTypeDefinition, type ModuleDefinition } from "./schema.js";
import { defineDocType } from "./metadata.js";
import { assertSettingDefinition } from "./settings.js";
import { assertLocalization } from "./localization.js";
import { FramekitError } from "./errors.js";

export function defineModule(
  definition: Omit<Partial<ModuleDefinition>, "doctypes" | "commands" | "settings"> & Pick<ModuleDefinition, "id" | "name"> & {
    doctypes?: z.input<typeof DocTypeSchema>[];
    commands?: z.input<typeof CommandDefinitionSchema>[];
    settings?: z.input<typeof SettingDefinitionSchema>[];
  }
): ModuleDefinition {
  const doctypes = (definition.doctypes ?? []).map((doctype) => defineDocType(doctype));
  const module = ModuleSchema.parse({
    version: "0.1.0",
    dependencies: [],
    permissions: [],
    navigation: [],
    commands: [],
    jobs: [],
    settings: [],
    ...definition,
    doctypes
  });
  const settingKeys = new Set<string>();
  for (const setting of module.settings) {
    if (settingKeys.has(setting.key)) throw new Error(`Duplicate setting key "${setting.key}" in module "${module.id}"`);
    settingKeys.add(setting.key);
    assertSettingDefinition(setting);
  }
  return module;
}

export function defineApp(definition: Omit<Partial<AppDefinition>, "modules"> & Pick<AppDefinition, "name"> & { modules?: ModuleDefinition[] }): AppDefinition {
  const app = AppSchema.parse({
    version: "0.1.0",
    modules: [],
    ...definition
  });
  assertNoDuplicateDoctypes(app.modules);
  assertModuleDependencies(app.modules);
  assertAppReferences(app);
  assertLocalization(app);
  const settingKeys = new Set<string>();
  for (const setting of app.modules.flatMap((module) => module.settings)) {
    if (settingKeys.has(setting.key)) throw new Error(`Duplicate application setting key "${setting.key}"`);
    settingKeys.add(setting.key);
  }
  return app;
}

export function getDocType(app: AppDefinition, name: string): DocTypeDefinition {
  const doctype = app.modules.flatMap((module) => module.doctypes).find((candidate) => candidate.name === name);
  if (!doctype) throw new FramekitError("DOCTYPE_NOT_FOUND", `Unknown DocType "${name}"`, 404);
  return doctype;
}

export function listDocTypes(app: AppDefinition): DocTypeDefinition[] {
  return app.modules.flatMap((module) => module.doctypes).sort((a, b) => a.label.localeCompare(b.label));
}

export function listNavigation(app: AppDefinition) {
  return app.modules.flatMap((module) => module.navigation).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}


function assertNoDuplicateDoctypes(modules: ModuleDefinition[]): void {
  const names = new Set<string>();
  for (const doctype of modules.flatMap((module) => module.doctypes)) {
    if (names.has(doctype.name)) {
      throw new Error(`Duplicate DocType "${doctype.name}"`);
    }
    names.add(doctype.name);
  }
}

function assertModuleDependencies(modules: ModuleDefinition[]): void {
  const ids = new Set<string>();
  for (const module of modules) {
    if (ids.has(module.id)) throw new Error(`Duplicate module id "${module.id}"`);
    ids.add(module.id);
  }
  for (const module of modules) {
    const dependencies = new Set<string>();
    for (const dependency of module.dependencies) {
      if (dependencies.has(dependency)) throw new Error(`Module "${module.id}" declares duplicate dependency "${dependency}"`);
      dependencies.add(dependency);
      if (!ids.has(dependency)) {
        throw new Error(`Module "${module.id}" requires missing dependency "${dependency}"`);
      }
      if (dependency === module.id) throw new Error(`Module "${module.id}" cannot depend on itself`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (visiting.has(id)) throw new Error(`Module dependency cycle: ${[...path, id].join(" -> ")}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const module = modules.find((candidate) => candidate.id === id)!;
    for (const dependency of module.dependencies) visit(dependency, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const module of modules) visit(module.id, []);
}


function assertAppReferences(app: AppDefinition): void {
  const doctypes = new Map(app.modules.flatMap((module) => module.doctypes).map((doctype) => [doctype.name, doctype]));
  const appCommandIds = new Set<string>();
  for (const doctype of doctypes.values()) {
    for (const field of doctype.fields) {
      if (field.type === "link" && !doctypes.has(field.linkTo!)) {
        throw new Error(`Link field "${doctype.name}.${field.name}" targets unknown DocType "${field.linkTo}"`);
      }
      for (const childField of field.fields ?? []) {
        if (childField.type === "link" && !doctypes.has(childField.linkTo!)) {
          throw new Error(`Link field "${doctype.name}.${field.name}.${childField.name}" targets unknown DocType "${childField.linkTo}"`);
        }
      }
    }
  }
  for (const module of app.modules) {
    const commandIds = new Set<string>();
    for (const command of module.commands) {
      if (commandIds.has(command.id)) throw new Error(`Duplicate command id "${command.id}" in module "${module.id}"`);
      commandIds.add(command.id);
      if (appCommandIds.has(command.id)) throw new Error(`Duplicate command id "${command.id}" across modules`);
      appCommandIds.add(command.id);
      for (const doctype of command.doctypes) {
        if (!doctypes.has(doctype)) throw new Error(`Command "${command.id}" in module "${module.id}" targets unknown DocType "${doctype}"`);
      }
      if (new Set(command.doctypes).size !== command.doctypes.length) throw new Error(`Command "${command.id}" repeats a DocType`);
      if (new Set(command.operations).size !== command.operations.length) throw new Error(`Command "${command.id}" repeats an operation`);
    }
    for (const [hookName, hooks] of Object.entries(module.hooks ?? {})) {
      for (const doctype of Object.keys(hooks ?? {})) {
        if (!doctypes.has(doctype)) throw new Error(`Hook "${hookName}" in module "${module.id}" targets unknown DocType "${doctype}"`);
      }
    }
  }
}
