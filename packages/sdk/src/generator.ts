import { listDocTypes, type AppDefinition, type FieldDefinition } from "@framekit/core";
import type { AttachmentMetadata, DocumentRecord } from "@framekit/core";

export function generateSdkTypes(app: AppDefinition): string {
  const lines: string[] = [
    "import type { AttachmentMetadata, DocumentRecord } from \"@framekit/core\";",
    "export { FramekitSdkError, FramekitValidationError, FramekitAuthenticationError, FramekitAuthorizationError, FramekitNotFoundError, FramekitConflictError, FramekitRateLimitError, FramekitServerError, FramekitResponseError, FramekitTransportError, FramekitProtocolError, FramekitCancelledError } from \"@framekit/sdk\";",
    "export type { FramekitClientConfigV1, FramekitClientConfigV2, FramekitRetryPolicy } from \"@framekit/sdk\";",
    ""
  ];
  for (const doctype of listDocTypes(app)) {
    const name = pascal(doctype.name);
    lines.push(`export type ${name}Input = {`);
    for (const field of doctype.fields.filter((candidate) => !candidate.computed && candidate.type !== "attachments")) {
      lines.push(`  ${field.name}${field.required ? "" : "?"}: ${tsType(field, "input")};`);
    }
    lines.push("};", "");
    lines.push(`export type ${name}Patch = Partial<${name}Input>;`);
    lines.push(`export type ${name}Data = {`);
    for (const field of doctype.fields) {
      lines.push(`  ${field.name}${field.required || field.computed ? "" : "?"}: ${tsType(field, "output")};`);
    }
    lines.push("};", "");
    lines.push(`export type ${name}Record = DocumentRecord<${name}Data>;`);
    if (doctype.workflow) {
      const actions = [...new Set(doctype.workflow.transitions.map((transition) => transition.action))];
      lines.push(`export type ${name}WorkflowAction = ${actions.map((action) => JSON.stringify(action)).join(" | ") || "never"};`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function tsType(field: FieldDefinition, direction: "input" | "output" = "output"): string {
  const domain = field.validators.find((validator) => validator.kind === "domain");
  if (domain?.kind === "domain") return domain.values.map((value) => JSON.stringify(value)).join(" | ");
  switch (field.type) {
    case "number":
      return "number";
    case "decimal":
    case "currency":
      return "string";
    case "boolean":
      return "boolean";
    case "json":
      return "unknown";
    case "select":
      return field.options?.length ? field.options.map((option) => JSON.stringify(option)).join(" | ") : "string";
    case "children":
      return `Array<{ id${direction === "input" ? "?" : ""}: string; position${direction === "input" ? "?" : ""}: number; data: { ${(field.fields ?? []).map((child) => `${child.name}${child.required ? "" : "?"}: ${tsType(child as FieldDefinition, direction)}`).join("; ")} } }>`;
    case "attachments":
      return "AttachmentMetadata[]";
    default:
      return "string";
  }
}

function pascal(value: string): string {
  return value.split(/[-_]/g).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
}
