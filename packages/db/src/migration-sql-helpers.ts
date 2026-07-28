import { FramekitError } from "@framekit/core";
import type { MigrationChange, MigrationRollback } from "@framekit/runtime";

export function rollbackFromChange(change: MigrationChange): MigrationRollback {
  if (change.rollback) return change.rollback;
  switch (change.kind) {
    case "add_doctype": return { kind: "remove_doctype", doctype: change.doctype, field: "*", destructive: true, from: change.to };
    case "add_field": return { kind: "remove_field", doctype: change.doctype, field: change.field, destructive: true, from: change.to };
    case "change_field_type": return { kind: "change_field_type", doctype: change.doctype, field: change.field, destructive: true, from: change.to, to: change.from };
    case "change_collection_schema": return { kind: "change_collection_schema", doctype: change.doctype, field: change.field, destructive: true, from: change.to, to: change.from };
    case "add_index": return { kind: "remove_index", doctype: change.doctype, field: change.field, destructive: false, from: change.to };
    case "remove_index": return { kind: "add_index", doctype: change.doctype, field: change.field, destructive: false, to: change.from };
    case "add_unique_constraint": return { kind: "remove_unique_constraint", doctype: change.doctype, field: change.field, destructive: false, from: change.to };
    case "remove_unique_constraint": return { kind: "add_unique_constraint", doctype: change.doctype, field: change.field, destructive: false, to: change.from };
    case "change_row_policy": return { kind: "change_row_policy", doctype: change.doctype, field: "row_policy", destructive: true, from: change.to, to: change.from };
    case "add_setting": return { kind: "remove_setting", doctype: "settings", field: change.field, destructive: true, from: change.to };
    case "remove_doctype": case "remove_field": case "remove_setting":
      throw new FramekitError("IRREVERSIBLE_MIGRATION", `Removing ${change.doctype}.${change.field} cannot be rolled back automatically.`, 409);
    case "change_setting": return { kind: "change_setting", doctype: "settings", field: change.field, destructive: true, from: change.to, to: change.from };
  }
}

export function indexIdentifier(change: Pick<MigrationChange, "doctype" | "field">, suffix: "idx" | "uniq"): string {
  return `framekit_documents_${identifierPart(change.doctype)}_${identifierPart(change.field)}_${suffix}`;
}

export function indexExpressions(fields: string): string[] { return fields.split(",").map((field) => `(data ->> ${sqlLiteral(field)})`); }
export function jsonPathSegment(value: string): string { return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\""); }
export function sqlLiteral(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
export function sqlLiteralJson(value: unknown): string { return sqlLiteral(JSON.stringify(value)); }

function identifierPart(value: string): string { return value.replaceAll(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase(); }
