import type { DocTypeDefinition, FieldDefinition } from "../domain/types";

export function orderedFields(doctype: DocTypeDefinition, preferred: string[] | undefined, fallback: string[]): FieldDefinition[] {
  const fields = (preferred && preferred.length > 0 ? preferred : fallback).map((name) => doctype.fields.find((field) => field.name === name)).filter((field): field is FieldDefinition => Boolean(field));
  return fields.length > 0 ? fields : doctype.fields;
}
export function exactDeskPattern(field: FieldDefinition): string {
  const precision = field.precision ?? 18; const scale = field.scale ?? (field.type === "currency" ? 2 : 6); const integerDigits = precision - scale; const whole = integerDigits === 0 ? "0" : `(?:0|[1-9][0-9]{0,${integerDigits - 1}})`;
  return scale === 0 ? `-?${whole}` : `-?${whole}(?:\\.[0-9]{1,${scale}})?`;
}
export function validDeskFieldValue(field: FieldDefinition, value: unknown): boolean {
  if (value === undefined || value === null || value === "") return !field.required;
  const domain = field.validators?.find((validator) => validator.kind === "domain");
  if (domain?.kind === "domain" && !domain.values.some((option) => Object.is(option, value))) return false;
  if (field.type !== "decimal" && field.type !== "currency") return true;
  if (typeof value !== "string" || !new RegExp(`^(?:${exactDeskPattern(field)})$`).test(value)) return false;
  const scale = field.scale ?? (field.type === "currency" ? 2 : 6);
  const coefficient = (candidate: string) => { const negative = candidate.startsWith("-"); const [whole, fraction = ""] = candidate.replace(/^-/, "").split("."); const result = BigInt(`${whole}${fraction.padEnd(scale, "0")}`); return negative ? -result : result; };
  const range = field.validators?.find((validator) => validator.kind === "range");
  return range?.kind !== "range" || (range.min === undefined || coefficient(value) >= coefficient(String(range.min))) && (range.max === undefined || coefficient(value) <= coefficient(String(range.max)));
}
