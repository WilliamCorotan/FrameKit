import { z } from "zod";
import { ChildFieldSchema, DocTypeSchema, decimalPrecision, decimalScale, type ChildFieldDefinition, type DocTypeDefinition, type FieldDefinition } from "./schema.js";

export function defineDocType(definition: z.input<typeof DocTypeSchema>): DocTypeDefinition {
  const parsed = DocTypeSchema.parse(definition);
  const fieldNames = new Set<string>();
  for (const field of parsed.fields) {
    if (fieldNames.has(field.name)) {
      throw new Error(`Duplicate field "${field.name}" in DocType "${parsed.name}"`);
    }
    fieldNames.add(field.name);
  }
  assertDocTypeInvariants(parsed);
  return parsed;
}


function assertDocTypeInvariants(doctype: DocTypeDefinition): void {
  const fields = new Map(doctype.fields.map((field) => [field.name, field]));
  if (doctype.rowPolicy && !doctype.ownership && [...doctype.rowPolicy.read, ...doctype.rowPolicy.write].some((rule) => rule.owner === "self")) {
    throw new Error(`DocType "${doctype.name}" uses owner policies without ownership metadata`);
  }
  for (const field of doctype.fields) {
    if (field.type === "children") {
      if (!field.fields?.length) throw new Error(`Children field "${doctype.name}.${field.name}" requires child fields`);
      if (field.unique || field.default !== undefined || field.options || field.linkTo || field.precision !== undefined || field.scale !== undefined || field.validators.length > 0 || field.computed) throw new Error(`Children field "${doctype.name}.${field.name}" uses unsupported scalar metadata`);
      const childNames = new Set<string>();
      for (const childField of field.fields) {
        if (childNames.has(childField.name)) throw new Error(`Children field "${doctype.name}.${field.name}" repeats child field "${childField.name}"`);
        childNames.add(childField.name);
        assertScalarFieldInvariants(doctype.name, `${field.name}.${childField.name}`, childField);
      }
      continue;
    }
    if (field.type === "attachments") {
      if (field.unique || field.default !== undefined || field.options || field.linkTo || field.fields || field.precision !== undefined || field.scale !== undefined || field.validators.length > 0 || field.computed) throw new Error(`Attachments field "${doctype.name}.${field.name}" uses unsupported metadata`);
      continue;
    }
    if (field.fields) throw new Error(`Only children fields may define child fields: "${doctype.name}.${field.name}"`);
    assertScalarFieldInvariants(doctype.name, field.name, field);
    const exactDecimal = field.type === "decimal" || field.type === "currency";
    if (field.computed) {
      if (field.computed.dependencies.includes(field.name)) throw new Error(`Computed field "${doctype.name}.${field.name}" cannot depend on itself`);
      for (const dependency of field.computed.dependencies) {
        if (!fields.has(dependency)) throw new Error(`Computed field "${doctype.name}.${field.name}" references unknown dependency "${dependency}"`);
      }
      if (["sum", "subtract", "multiply"].includes(field.computed.operation) && !exactDecimal) {
        throw new Error(`Computed ${field.computed.operation} field "${doctype.name}.${field.name}" must be decimal or currency`);
      }
      if (field.computed.operation === "concat" && !["text", "long_text"].includes(field.type)) {
        throw new Error(`Computed concat field "${doctype.name}.${field.name}" must be text or long_text`);
      }
      if (field.computed.operation === "subtract" && field.computed.dependencies.length !== 2) throw new Error(`Computed subtract field "${doctype.name}.${field.name}" requires exactly two dependencies`);
      if (field.computed.operation === "multiply" && field.computed.dependencies.length < 2) throw new Error(`Computed multiply field "${doctype.name}.${field.name}" requires at least two dependencies`);
      for (const dependency of field.computed.dependencies) {
        const dependencyType = fields.get(dependency)!.type;
        if (["sum", "subtract", "multiply"].includes(field.computed.operation) && !["decimal", "currency"].includes(dependencyType)) {
          throw new Error(`Computed ${field.computed.operation} field "${doctype.name}.${field.name}" requires decimal dependencies`);
        }
        if (field.computed.operation === "concat" && dependencyType === "json") throw new Error(`Computed concat field "${doctype.name}.${field.name}" cannot depend on JSON`);
      }
    }
  }
  const visitingComputed = new Set<string>();
  const visitedComputed = new Set<string>();
  const visitComputed = (name: string, path: string[]) => {
    if (visitingComputed.has(name)) throw new Error(`Computed field dependency cycle: ${[...path, name].join(" -> ")}`);
    if (visitedComputed.has(name)) return;
    visitingComputed.add(name);
    const field = fields.get(name);
    for (const dependency of field?.computed?.dependencies ?? []) {
      if (fields.get(dependency)?.computed) visitComputed(dependency, [...path, name]);
    }
    visitingComputed.delete(name);
    visitedComputed.add(name);
  };
  for (const field of doctype.fields.filter((candidate) => candidate.computed)) visitComputed(field.name, []);
  const indexes = new Set<string>();
  for (const index of doctype.indexes) {
    if (index.some((name) => ["children", "attachments"].includes(fields.get(name)?.type ?? ""))) throw new Error(`Index on "${doctype.name}" cannot include managed collection fields`);
    if (new Set(index).size !== index.length) throw new Error(`Index on "${doctype.name}" repeats a field`);
    for (const field of index) if (!fields.has(field)) throw new Error(`Index on "${doctype.name}" references unknown field "${field}"`);
    const key = index.join("\u0000");
    if (indexes.has(key)) throw new Error(`Duplicate index on "${doctype.name}": ${index.join(", ")}`);
    indexes.add(key);
  }
  if (doctype.naming.field) {
    const field = fields.get(doctype.naming.field);
    if (!field) throw new Error(`Naming field "${doctype.naming.field}" does not exist on "${doctype.name}"`);
    if (field.type !== "text") throw new Error(`Naming field "${doctype.name}.${field.name}" must be text`);
    if (doctype.naming.series) throw new Error(`DocType "${doctype.name}" cannot combine field naming with a series`);
  }
  const viewIds = new Set<string>();
  for (const view of doctype.views) {
    if (view.doctype !== doctype.name) throw new Error(`View "${view.id}" belongs to "${view.doctype}", not "${doctype.name}"`);
    if (viewIds.has(view.id)) throw new Error(`Duplicate view id "${view.id}" on "${doctype.name}"`);
    viewIds.add(view.id);
    if (new Set(view.fields).size !== view.fields.length) throw new Error(`View "${view.id}" repeats a field`);
    for (const field of view.fields) if (!fields.has(field)) throw new Error(`View "${view.id}" references unknown field "${field}"`);
  }
  if (!doctype.workflow) return;
  const workflow = doctype.workflow;
  const workflowField = fields.get(workflow.field);
  if (!workflowField) throw new Error(`Workflow field "${workflow.field}" does not exist on "${doctype.name}"`);
  if (workflowField.type !== "select") throw new Error(`Workflow field "${doctype.name}.${workflow.field}" must be select`);
  if (workflowField.default !== undefined && workflowField.default !== workflow.initialState) {
    throw new Error(`Workflow field default for "${doctype.name}.${workflow.field}" must match initial state "${workflow.initialState}"`);
  }
  if (new Set(workflow.states).size !== workflow.states.length) throw new Error(`Workflow on "${doctype.name}" has duplicate states`);
  const states = new Set(workflow.states);
  if (!states.has(workflow.initialState)) throw new Error(`Workflow initial state "${workflow.initialState}" is not listed in states`);
  for (const state of states) {
    if (!workflowField.options?.includes(state)) throw new Error(`Workflow state "${state}" is not an option of "${doctype.name}.${workflow.field}"`);
  }
  const endpoints = new Set<string>();
  for (const transition of workflow.transitions) {
    if (!states.has(transition.to)) throw new Error(`Workflow transition "${transition.action}" targets unknown state "${transition.to}"`);
    if (new Set(transition.from).size !== transition.from.length) throw new Error(`Workflow transition "${transition.action}" repeats a source state`);
    for (const from of transition.from) {
      if (!states.has(from)) throw new Error(`Workflow transition "${transition.action}" starts from unknown state "${from}"`);
      const endpoint = `${transition.action}\u0000${from}`;
      if (endpoints.has(endpoint)) throw new Error(`Workflow action "${transition.action}" is ambiguous from state "${from}"`);
      endpoints.add(endpoint);
    }
  }
}

type ScalarFieldDefinition = z.infer<typeof ChildFieldSchema> | FieldDefinition;

function exactDecimalCoefficient(value: unknown, field: ScalarFieldDefinition, label: string): bigint {
  if (typeof value !== "string") throw new Error(`${label} must use an exact decimal string`);
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (!match) throw new Error(`${label} is not a base-10 decimal`);
  const fraction = match[3] ?? "";
  const scale = decimalScale(field);
  if (fraction.length > scale) throw new Error(`${label} exceeds scale ${scale}`);
  const integerDigits = match[2] === "0" ? 0 : match[2]!.length;
  if (integerDigits + scale > decimalPrecision(field)) throw new Error(`${label} exceeds precision ${decimalPrecision(field)}`);
  const coefficient = BigInt(`${match[1] === "-" ? "-" : ""}${match[2]}${fraction.padEnd(scale, "0")}`);
  return coefficient;
}

function canonicalDomainValue(field: ScalarFieldDefinition, value: string | number | boolean, label: string): string {
  if (field.type === "decimal" || field.type === "currency") {
    return `string:${JSON.stringify(canonicalExactValue(value, field, `${label} domain value`))}`;
  }
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error(`Domain value for "${label}" must be a finite safe number`);
    return `number:${JSON.stringify(value)}`;
  }
  if (field.type === "boolean") {
    if (typeof value !== "boolean") throw new Error(`Domain value for "${label}" must be boolean`);
    return `boolean:${JSON.stringify(value)}`;
  }
  if (typeof value !== "string") throw new Error(`Domain value for "${label}" must be a string`);
  if (field.type === "select" && !field.options?.includes(value)) throw new Error(`Domain value for "${label}" must be a select option`);
  return `string:${JSON.stringify(value)}`;
}

function canonicalExactValue(value: unknown, field: ScalarFieldDefinition, label: string): string {
  const coefficient = exactDecimalCoefficient(value, field, label);
  const scale = decimalScale(field);
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  const normalized = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${normalized}` : normalized;
}

function assertScalarFieldInvariants(doctype: string, path: string, field: ScalarFieldDefinition): void {
  const exactDecimal = field.type === "decimal" || field.type === "currency";
  if (exactDecimal) {
    if (decimalScale(field) > decimalPrecision(field)) throw new Error(`Scale for "${doctype}.${path}" cannot exceed precision`);
    if (field.default !== undefined) field.default = canonicalExactValue(field.default, field, `${doctype}.${path} default`);
  } else if (field.precision !== undefined || field.scale !== undefined) {
    throw new Error(`Only decimal and currency fields may declare precision or scale: "${doctype}.${path}"`);
  }
  if (field.type === "select") {
    if (!field.options?.length) throw new Error(`Select field "${doctype}.${path}" requires options`);
    if (new Set(field.options).size !== field.options.length) throw new Error(`Select field "${doctype}.${path}" has duplicate options`);
    if (field.default !== undefined && !field.options.includes(String(field.default))) throw new Error(`Default for "${doctype}.${path}" is not a select option`);
  } else if (field.options) {
    throw new Error(`Only select fields may define options: "${doctype}.${path}"`);
  }
  if (field.type === "link" && !field.linkTo) throw new Error(`Link field "${doctype}.${path}" requires linkTo`);
  if (field.type !== "link" && field.linkTo) throw new Error(`Only link fields may define linkTo: "${doctype}.${path}"`);
  if (field.unique && field.type === "json") throw new Error(`JSON field "${doctype}.${path}" cannot be unique`);
  for (const validator of field.validators) {
    if (validator.kind === "length") {
      if (!["text", "long_text", "select", "link"].includes(field.type)) throw new Error(`Length validator on "${doctype}.${path}" requires a string field`);
      if (validator.min === undefined && validator.max === undefined) throw new Error(`Length validator on "${doctype}.${path}" requires min or max`);
      if (validator.min !== undefined && validator.max !== undefined && validator.min > validator.max) throw new Error(`Length validator on "${doctype}.${path}" has min greater than max`);
    }
    if (validator.kind === "range") {
      if (!["number", "decimal", "currency"].includes(field.type)) throw new Error(`Range validator on "${doctype}.${path}" requires a numeric field`);
      if (validator.min === undefined && validator.max === undefined) throw new Error(`Range validator on "${doctype}.${path}" requires min or max`);
      if (exactDecimal) {
        const min = validator.min === undefined ? undefined : exactDecimalCoefficient(validator.min, field, `${doctype}.${path} minimum`);
        const max = validator.max === undefined ? undefined : exactDecimalCoefficient(validator.max, field, `${doctype}.${path} maximum`);
        if (min !== undefined && max !== undefined && min > max) throw new Error(`Range validator on "${doctype}.${path}" has min greater than max`);
        if (validator.min !== undefined) validator.min = canonicalExactValue(validator.min, field, `${doctype}.${path} minimum`);
        if (validator.max !== undefined) validator.max = canonicalExactValue(validator.max, field, `${doctype}.${path} maximum`);
      } else {
        for (const [label, bound] of [["minimum", validator.min], ["maximum", validator.max]] as const) {
          if (bound !== undefined && (typeof bound !== "number" || !Number.isFinite(bound) || Math.abs(bound) > Number.MAX_SAFE_INTEGER)) throw new Error(`${label} for "${doctype}.${path}" must be a finite safe number`);
        }
        if (validator.min !== undefined && validator.max !== undefined && validator.min > validator.max) throw new Error(`Range validator on "${doctype}.${path}" has min greater than max`);
      }
    }
    if (validator.kind === "pattern" && !["text", "long_text", "link"].includes(field.type)) throw new Error(`Pattern validator on "${doctype}.${path}" requires a string field`);
    if (validator.kind === "domain") {
      if (field.type === "json") throw new Error(`Domain validator on "${doctype}.${path}" cannot target JSON`);
      const canonical = validator.values.map((value) => canonicalDomainValue(field, value, `${doctype}.${path}`));
      if (new Set(canonical).size !== canonical.length) throw new Error(`Domain validator on "${doctype}.${path}" has duplicate canonical values`);
      validator.values.splice(0, validator.values.length, ...canonical.map((value) => JSON.parse(value.slice(value.indexOf(":") + 1)) as string | number | boolean));
    }
  }
}

