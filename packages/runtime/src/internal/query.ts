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

import { compareDecimalStrings, normalizeExactDecimal } from "./validation.js";
export function validateListOptions(doctype: DocTypeDefinition, options: ListOptions = {}): void {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new FramekitError("INVALID_QUERY", "Document query options must be an object", 422);
  }
  if (options.search !== undefined && typeof options.search !== "string") {
    throw new FramekitError("INVALID_QUERY", "search must be a string", 422);
  }
  if (options.filters !== undefined && (!options.filters || typeof options.filters !== "object" || Array.isArray(options.filters))) {
    throw new FramekitError("INVALID_QUERY", "filters must be an object", 422);
  }
  if (options.sort !== undefined && (
    !options.sort || typeof options.sort !== "object" || Array.isArray(options.sort) ||
    typeof options.sort.field !== "string" || ![undefined, "asc", "desc"].includes(options.sort.direction)
  )) {
    throw new FramekitError("INVALID_QUERY", "sort must contain a field and an asc or desc direction", 422);
  }
  if (options.cursor !== undefined && typeof options.cursor !== "string") {
    throw new FramekitError("INVALID_QUERY", "cursor must be a string", 422);
  }
  if (options.fields !== undefined && (!Array.isArray(options.fields) || !options.fields.every((field) => typeof field === "string"))) {
    throw new FramekitError("INVALID_QUERY", "fields must be an array of field names", 422);
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1_000)) {
    throw new FramekitError("INVALID_LIMIT", "limit must be an integer between 1 and 1000", 422);
  }
  if (options.offset !== undefined && (!Number.isInteger(options.offset) || options.offset < 0)) {
    throw new FramekitError("INVALID_OFFSET", "offset must be a non-negative integer", 422);
  }
  const validFields = new Set(doctype.fields.map((field) => field.name));
  for (const [field, filter] of Object.entries(options.filters ?? {})) {
    if (!validFields.has(field)) {
      throw new FramekitError("UNKNOWN_FILTER_FIELD", `Unknown filter field "${field}" for ${doctype.name}`, 422);
    }
    const fieldDefinition = doctype.fields.find((candidate) => candidate.name === field);
    assertFilterShape(doctype.name, field, filter, fieldDefinition);
    if (fieldDefinition?.type === "json" && !isJsonNullFilter(filter)) {
      throw new FramekitError("UNSUPPORTED_QUERY_SHAPE", `JSON field "${field}" only supports isNull filtering`, 422);
    }
  }
  if (options.sort && options.sort.field !== "id" && options.sort.field !== "createdAt" && options.sort.field !== "updatedAt" && !validFields.has(options.sort.field)) {
    throw new FramekitError("UNKNOWN_SORT_FIELD", `Unknown sort field "${options.sort.field}" for ${doctype.name}`, 422);
  }
  const sortField = doctype.fields.find((field) => field.name === options.sort?.field);
  if (sortField?.type === "json") {
    throw new FramekitError("UNSUPPORTED_QUERY_SHAPE", `Sorting JSON field "${sortField.name}" is not supported`, 422);
  }
  if (options.cursor) decodeDocumentCursor(options.cursor, options.sort, doctype);
  const unknownProjectionFields = (options.fields ?? []).filter((field) => !validFields.has(field));
  if (unknownProjectionFields.length > 0) {
    throw new FramekitError("UNKNOWN_PROJECTION_FIELD", `Unknown projection fields for ${doctype.name}: ${unknownProjectionFields.join(", ")}`, 422);
  }
}

export function applyFilters(records: DocumentRecord[], filters: Record<string, FilterValue> = {}, doctype?: DocTypeDefinition): DocumentRecord[] {
  const entries = Object.entries(filters).filter(([, value]) => value !== undefined && value !== "");
  if (entries.length === 0) {
    return records;
  }
  return records.filter((record) =>
    entries.every(([field, expected]) => {
      const actual = record.data[field];
      return matchesFilter(actual, expected, doctype?.fields.find((candidate) => candidate.name === field)?.type);
    })
  );
}

export function applyListOptions(records: DocumentRecord[], options: ListOptions = {}): DocumentRecord[] {
  return applyListOptionsPage(records, options).items;
}

export function applyListOptionsPage(records: DocumentRecord[], options: ListOptions = {}, doctype?: DocTypeDefinition): DocumentPage {
  const searchableFields = new Set(doctype?.fields.filter((field) => field.type !== "json").map((field) => field.name));
  const searched = options.search
    ? records.filter((record) => Object.entries(record.data).some(([field, value]) =>
        (!doctype || searchableFields.has(field)) && String(value ?? "").toLowerCase().includes(options.search!.toLowerCase())
      ))
    : records;
  const sorted = sortRecords(applyFilters(searched, options.filters, doctype), options.sort, doctype);
  const cursor = options.cursor ? decodeDocumentCursor(options.cursor, options.sort, doctype) : undefined;
  const afterCursor = cursor ? sorted.filter((record) => recordAfterCursor(record, cursor, doctype)) : sorted;
  const limit = options.limit ?? 100;
  const candidates = afterCursor.slice(options.offset ?? 0, (options.offset ?? 0) + limit + 1);
  const hasMore = candidates.length > limit;
  const page = candidates.slice(0, limit);
  return {
    items: projectRecords(page, options.fields),
    nextCursor: hasMore && page.length > 0 ? encodeDocumentCursor(page.at(-1)!, options.sort, doctype) : undefined
  };
}

function projectRecords(records: DocumentRecord[], fields?: string[]): DocumentRecord[] {
  if (!fields) {
    return records.map((record) => ({ ...record, data: { ...record.data } }));
  }
  return records.map((record) => {
    const data: DocumentData = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(record.data, field)) {
        data[field] = record.data[field];
      }
    }
    return { ...record, data };
  });
}

function matchesFilter(actual: unknown, expected: FilterValue, fieldType?: string): boolean {
  if (isFilterOperator(expected)) {
    if ("isNull" in expected && expected.isNull !== undefined) {
      const isNull = actual === undefined || actual === null || actual === "";
      if (isNull !== expected.isNull) {
        return false;
      }
    }
    if ("eq" in expected && !sameValue(actual, expected.eq, fieldType)) {
      return false;
    }
    if ("ne" in expected && sameValue(actual, expected.ne, fieldType)) {
      return false;
    }
    if ("in" in expected && expected.in && !expected.in.some((item) => sameValue(actual, item, fieldType))) {
      return false;
    }
    if ("contains" in expected && expected.contains !== undefined && !String(actual ?? "").toLowerCase().includes(expected.contains.toLowerCase())) {
      return false;
    }
    const missingNumericValue = ["number", "decimal", "currency"].includes(fieldType ?? "") && (actual === undefined || actual === null || actual === "");
    if ("gt" in expected && expected.gt !== undefined && (missingNumericValue || !(compareValues(actual, expected.gt, fieldType) > 0))) {
      return false;
    }
    if ("gte" in expected && expected.gte !== undefined && (missingNumericValue || !(compareValues(actual, expected.gte, fieldType) >= 0))) {
      return false;
    }
    if ("lt" in expected && expected.lt !== undefined && (missingNumericValue || !(compareValues(actual, expected.lt, fieldType) < 0))) {
      return false;
    }
    if ("lte" in expected && expected.lte !== undefined && (missingNumericValue || !(compareValues(actual, expected.lte, fieldType) <= 0))) {
      return false;
    }
    return true;
  }
  if (Array.isArray(expected)) {
    return expected.some((item) => sameValue(actual, item, fieldType));
  }
  return sameValue(actual, expected, fieldType);
}

function assertFilterShape(doctype: string, field: string, filter: FilterValue, fieldDefinition?: FieldDefinition): void {
  const fieldType = fieldDefinition?.type;
  const invalid = (message: string): never => {
    throw new FramekitError("INVALID_QUERY", `${doctype}.${field} ${message}`, 422);
  };
  const validateExact = (value: unknown) => {
    if ((fieldType === "decimal" || fieldType === "currency") && value !== null && value !== undefined) {
      normalizeExactDecimal(value, decimalPrecision(fieldDefinition!), decimalScale(fieldDefinition!), `${doctype}.${field}`);
    }
  };
  if (Array.isArray(filter)) {
    if (!filter.every(isFilterPrimitive)) invalid("array filters must contain only scalar values");
    filter.forEach(validateExact);
    return;
  }
  if (!isFilterOperator(filter)) {
    validateExact(filter);
    return;
  }
  const allowed = new Set(["eq", "ne", "in", "contains", "gt", "gte", "lt", "lte", "isNull"]);
  const unknown = Object.keys(filter).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    invalid(`contains unknown filter operators: ${unknown.join(", ")}`);
  }
  if (Object.keys(filter).length === 0) invalid("filter operator object must not be empty");
  if (filter.in !== undefined && !Array.isArray(filter.in)) {
    invalid("in filter must be an array");
  }
  if (filter.in?.some((value) => !isFilterPrimitive(value))) invalid("in filter must contain only scalar values");
  filter.in?.forEach(validateExact);
  if (filter.contains !== undefined && typeof filter.contains !== "string") invalid("contains filter must be a string");
  if (filter.isNull !== undefined && typeof filter.isNull !== "boolean") invalid("isNull filter must be a boolean");
  for (const operator of ["eq", "ne", "gt", "gte", "lt", "lte"] as const) {
    const value = filter[operator];
    if (value !== undefined && !isFilterPrimitive(value)) invalid(`${operator} filter must be a scalar value`);
    if (value !== undefined) validateExact(value);
  }
  for (const operator of ["gt", "gte", "lt", "lte"] as const) {
    const value = filter[operator];
    if (value !== undefined && typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) {
      invalid(`${operator} filter must be a string or finite number`);
    }
  }
  if (fieldType === "number") {
    for (const operator of ["gt", "gte", "lt", "lte"] as const) {
      const value = filter[operator];
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
        invalid(`${operator} filter must be a finite number`);
      }
    }
  }
}

function isFilterPrimitive(value: unknown): value is FilterPrimitive {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isFilterOperator(value: unknown): value is FilterOperator {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJsonNullFilter(value: FilterValue): boolean {
  return isFilterOperator(value) && Object.keys(value).length === 1 && value.isNull !== undefined;
}

function sameValue(left: unknown, right: unknown, fieldType?: string): boolean {
  if (left === undefined) return false;
  if (left === null || right === null) return left === right;
  if (fieldType === "decimal" || fieldType === "currency") return compareDecimalStrings(String(left), String(right)) === 0;
  return String(left) === String(right);
}

function compareValues(left: unknown, right: unknown, fieldType?: string): number {
  if (fieldType === "number") return Number(left) - Number(right);
  if (fieldType === "decimal" || fieldType === "currency") return compareDecimalStrings(String(left || "0"), String(right || "0"));
  return compareCodePoints(String(left ?? ""), String(right ?? ""));
}

/** Matches PostgreSQL UTF-8 byte ordering under the C collation. */
function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index]! - rightPoints[index]!;
  }
  return leftPoints.length - rightPoints.length;
}

export function filterPrimitive(value: unknown): FilterPrimitive {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  return String(value);
}

export function sortRecords(records: DocumentRecord[], sort: ListOptions["sort"] = { field: "updatedAt", direction: "desc" }, doctype?: DocTypeDefinition): DocumentRecord[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  const fieldType = doctype?.fields.find((field) => field.name === sort.field)?.type;
  return [...records].sort((left, right) => {
    const primary = compareValues(sortableValue(left, sort.field), sortableValue(right, sort.field), fieldType);
    if (primary !== 0) return direction * primary;
    return compareCodePoints(left.id, right.id);
  });
}

function sortableValue(record: DocumentRecord, field: string): unknown {
  if (field === "id") {
    return record.id;
  }
  if (field === "createdAt") {
    return record.createdAt;
  }
  if (field === "updatedAt") {
    return record.updatedAt;
  }
  const value = record.data[field];
  return value === undefined || value === null ? "" : value;
}

type DocumentCursor = {
  v: 1;
  field: string;
  direction: "asc" | "desc";
  value: string | number | boolean;
  id: string;
};

export function encodeDocumentCursor(record: DocumentRecord, sort: ListOptions["sort"], doctype?: DocTypeDefinition): string {
  const normalized = normalizeSort(sort);
  const fieldType = doctype?.fields.find((field) => field.name === normalized.field)?.type;
  const rawValue = sortableValue(record, normalized.field);
  const value = fieldType === "number" ? Number(rawValue) : String(rawValue);
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new FramekitError("UNSUPPORTED_QUERY_SHAPE", `Cannot create a cursor for ${normalized.field}`, 422);
  }
  const payload: DocumentCursor = { v: 1, ...normalized, value, id: record.id };
  return base64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodeDocumentCursor(cursor: string, sort: ListOptions["sort"], doctype?: DocTypeDefinition): DocumentCursor {
  let payload: unknown;
  try {
    const base64 = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))));
  } catch {
    throw new FramekitError("INVALID_CURSOR", "Cursor is not a valid Framekit document cursor", 422);
  }
  const expected = normalizeSort(sort);
  const candidate = payload as Partial<DocumentCursor>;
  if (
    candidate.v !== 1 || candidate.field !== expected.field || candidate.direction !== expected.direction ||
    typeof candidate.id !== "string" || !["string", "number", "boolean"].includes(typeof candidate.value)
  ) {
    throw new FramekitError("INVALID_CURSOR", "Cursor does not match the requested sort order", 422);
  }
  const field = doctype?.fields.find((item) => item.name === expected.field);
  if (field?.type === "json") {
    throw new FramekitError("UNSUPPORTED_QUERY_SHAPE", `Sorting JSON field "${field.name}" is not supported`, 422);
  }
  const expectedValueType = field?.type === "number"
    ? "number"
    : "string";
  if (typeof candidate.value !== expectedValueType || (expectedValueType === "number" && !Number.isFinite(candidate.value))) {
    throw new FramekitError("INVALID_CURSOR", "Cursor value does not match the requested sort field", 422);
  }
  if ((field?.type === "decimal" || field?.type === "currency") && normalizeExactDecimal(candidate.value, decimalPrecision(field), decimalScale(field)) !== candidate.value) {
    throw new FramekitError("INVALID_CURSOR", "Cursor value is not a canonical exact decimal", 422);
  }
  return candidate as DocumentCursor;
}

function recordAfterCursor(record: DocumentRecord, cursor: DocumentCursor, doctype?: DocTypeDefinition): boolean {
  const fieldType = doctype?.fields.find((field) => field.name === cursor.field)?.type;
  const primary = compareValues(sortableValue(record, cursor.field), cursor.value, fieldType);
  const directed = cursor.direction === "asc" ? primary : -primary;
  return directed > 0 || (directed === 0 && compareCodePoints(record.id, cursor.id) > 0);
}

function normalizeSort(sort: ListOptions["sort"]): { field: string; direction: "asc" | "desc" } {
  return {
    field: sort?.field ?? "updatedAt",
    direction: sort?.direction === "asc" ? "asc" : "desc"
  };
}


function base64Url(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
