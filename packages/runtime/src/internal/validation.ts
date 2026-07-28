import {
  assertPermission,
  canTransferOwnership,
  CustomFieldSchema,
  defineApp,
  defineDocType,
  DocumentCommandRequestSchema,
  decimalPrecision,
  decimalScale,
  FramekitError,
  getDocType,
  hasRowAccess,
  hasAccess,
  localeFallbackChain,
  resolveTranslation,
  validateSettingValue,
  ViewSchema,
  type AppDefinition,
  type AttachmentMetadata,
  type ChildRecord,
  type CustomFieldDefinition,
  type DocTypeDefinition,
  type DocumentData,
  type DocumentCommandOperation,
  type DocumentCommandRequest,
  type DocumentRecord,
  type FieldDefinition,
  type HookName,
  type OwnerTransferReceipt,
  type SettingDefinition,
  type TenantContext,
  type ViewDefinition
} from "@framekit/core";

import type { FilterPrimitive, FilterOperator, FilterValue, ListOptions, DocumentPage } from "./types.js";
export function coerceFieldValue(doctype: string, field: FieldDefinition, value: unknown): unknown {
  if (value === null) {
    return value;
  }
  switch (field.type) {
    case "number": {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        throw new FramekitError("VALIDATION_FAILED", `${doctype}.${field.name} must be a number`, 422);
      }
      return number;
    }
    case "decimal":
    case "currency":
      return normalizeExactDecimal(value, decimalPrecision(field), decimalScale(field), `${doctype}.${field.name}`);
    case "boolean":
      return Boolean(value);
    case "select":
      if (field.options && !field.options.includes(String(value))) {
        throw new FramekitError("VALIDATION_FAILED", `${doctype}.${field.name} must be one of ${field.options.join(", ")}`, 422);
      }
      return String(value);
    case "json":
      return value;
    default:
      return String(value);
  }
}

type ParsedDecimal = { coefficient: bigint; scale: number };

export function normalizeExactDecimal(value: unknown, precision: number, scale: number, field = "decimal"): string {
  if (typeof value !== "string") throw decimalError(field, "decimal_string_required", "Decimal value must be a canonical base-10 string.");
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (!match) throw decimalError(field, "decimal_format", "Decimal value is not in canonical base-10 notation.");
  const fraction = match[3] ?? "";
  if (fraction.length > scale) throw decimalError(field, "decimal_scale", `Decimal value exceeds scale ${scale}.`);
  const whole = match[2]!;
  const integerDigits = whole === "0" ? 0 : whole.length;
  if (integerDigits + scale > precision) throw decimalError(field, "decimal_precision", `Decimal value exceeds precision ${precision}.`);
  const padded = fraction.padEnd(scale, "0");
  const zero = whole === "0" && [...padded].every((digit) => digit === "0");
  const sign = match[1] === "-" && !zero ? "-" : "";
  return scale === 0 ? `${sign}${whole}` : `${sign}${whole}.${padded}`;
}

export function addExactDecimals(values: string[], precision: number, scale: number): string {
  const parsed = values.map(parseDecimal);
  const commonScale = Math.max(0, ...parsed.map((value) => value.scale));
  const coefficient = parsed.reduce((total, value) => total + rescaleCoefficient(value, commonScale), 0n);
  const exact = { coefficient: rescaleCoefficient({ coefficient, scale: commonScale }, scale), scale };
  return normalizeExactDecimal(formatDecimal(exact), precision, scale);
}

function decimalError(field: string, code: string, message: string): FramekitError {
  return new FramekitError("DECIMAL_VALIDATION_FAILED", `${field}: ${message}`, 422, { field, code });
}

function parseDecimal(value: string): ParsedDecimal {
  const negative = value.startsWith("-");
  const unsigned = value.replace(/^[+-]/, "");
  const [whole = "0", fraction = ""] = unsigned.split(".");
  return { coefficient: BigInt(`${negative ? "-" : ""}${whole}${fraction}`), scale: fraction.length };
}

function rescaleCoefficient(value: ParsedDecimal, scale: number): bigint {
  if (value.scale === scale) return value.coefficient;
  if (value.scale < scale) return value.coefficient * (10n ** BigInt(scale - value.scale));
  const divisor = 10n ** BigInt(value.scale - scale);
  if (value.coefficient % divisor !== 0n) throw decimalError("computed", "decimal_scale", "Computed result cannot be represented at the target scale.");
  return value.coefficient / divisor;
}

function formatDecimal(value: ParsedDecimal): string {
  const negative = value.coefficient < 0n;
  const digits = (negative ? -value.coefficient : value.coefficient).toString().padStart(value.scale + 1, "0");
  const body = value.scale === 0 ? digits : `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`;
  return negative ? `-${body}` : body;
}

export function computeFieldValue(doctype: string, field: FieldDefinition, data: DocumentData): unknown {
  const computed = field.computed!;
  const values = computed.dependencies.map((dependency) => data[dependency]);
  if (values.some((value) => value === undefined || value === null)) return null;
  if (computed.operation === "concat") return values.map(String).join(computed.separator ?? "");
  const decimals = values.map((value) => String(value)).map(parseDecimal);
  let result: ParsedDecimal;
  if (computed.operation === "sum") {
    const scale = Math.max(...decimals.map((value) => value.scale));
    result = { coefficient: decimals.reduce((total, value) => total + rescaleCoefficient(value, scale), 0n), scale };
  } else if (computed.operation === "subtract") {
    const scale = Math.max(...decimals.map((value) => value.scale));
    result = { coefficient: rescaleCoefficient(decimals[0]!, scale) - rescaleCoefficient(decimals[1]!, scale), scale };
  } else {
    result = decimals.reduce<ParsedDecimal>((product, value) => ({ coefficient: product.coefficient * value.coefficient, scale: product.scale + value.scale }), { coefficient: 1n, scale: 0 });
  }
  const targetScale = decimalScale(field);
  const exact = { coefficient: rescaleCoefficient(result, targetScale), scale: targetScale };
  return normalizeExactDecimal(formatDecimal(exact), decimalPrecision(field), targetScale, `${doctype}.${field.name}`);
}

type FieldViolation = { field: string; rule: string; code: string; params?: Record<string, unknown> };

export function validateFieldValue(doctype: string, field: FieldDefinition, value: unknown): FieldViolation[] {
  const violations: FieldViolation[] = [];
  if (field.required && (value === undefined || value === null || value === "")) {
    violations.push({ field: field.name, rule: "required", code: "required" });
    return violations;
  }
  if (value === undefined || value === null) return violations;
  for (const validator of field.validators) {
    if (validator.kind === "length") {
      const length = [...String(value)].length;
      if (validator.min !== undefined && length < validator.min) violations.push({ field: field.name, rule: "length", code: "length_min", params: { min: validator.min, actual: length } });
      if (validator.max !== undefined && length > validator.max) violations.push({ field: field.name, rule: "length", code: "length_max", params: { max: validator.max, actual: length } });
    } else if (validator.kind === "range") {
      const exact = field.type === "decimal" || field.type === "currency";
      const compare = (bound: string | number) => exact
        ? compareDecimalStrings(String(value), normalizeExactDecimal(bound, decimalPrecision(field), decimalScale(field)))
        : Number(value) - Number(bound);
      if (validator.min !== undefined && compare(validator.min) < 0) violations.push({ field: field.name, rule: "range", code: "range_min", params: { min: validator.min } });
      if (validator.max !== undefined && compare(validator.max) > 0) violations.push({ field: field.name, rule: "range", code: "range_max", params: { max: validator.max } });
    } else if (validator.kind === "pattern" && !matchesPattern(validator.pattern, String(value))) {
      violations.push({ field: field.name, rule: "pattern", code: `pattern_${validator.pattern}`, params: { pattern: validator.pattern } });
    } else if (validator.kind === "domain" && !validator.values.some((candidate) => String(candidate) === String(value))) {
      violations.push({ field: field.name, rule: "domain", code: "domain", params: { values: validator.values } });
    }
  }
  return violations;
}

export function compareDecimalStrings(left: string, right: string): number {
  const leftParsed = parseDecimal(left);
  const rightParsed = parseDecimal(right);
  const scale = Math.max(leftParsed.scale, rightParsed.scale);
  const difference = rescaleCoefficient(leftParsed, scale) - rescaleCoefficient(rightParsed, scale);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function matchesPattern(pattern: "email" | "uuid" | "slug" | "alphanumeric", value: string): boolean {
  if (pattern === "email") {
    const at = value.indexOf("@");
    return at > 0 && at === value.lastIndexOf("@") && value.indexOf(".", at + 2) > at + 1 && !value.includes(" ");
  }
  if (pattern === "uuid") return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  if (pattern === "slug") return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
  return /^[a-z0-9]+$/i.test(value);
}
