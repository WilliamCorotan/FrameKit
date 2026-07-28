import { FramekitError } from "@framekit/core";

const SENSITIVE_TELEMETRY_KEY = /authorization|cookie|password|secret|token|api[-_]?key/i;
const BEARER_VALUE = /\bBearer\s+[^\s,;]+/gi;
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

/** Removes credentials before errors or request telemetry leave the adapter. */
export function redactTelemetryError(error: unknown): unknown {
  if (error instanceof FramekitError) {
    return { name: error.name, code: error.code, message: redactTelemetryString(error.message) };
  }
  if (error instanceof Error) {
    return { name: error.name, message: redactTelemetryString(error.message) };
  }
  return redactTelemetry(error);
}

export function redactTelemetry(value: unknown, key?: string, seen = new WeakSet<object>()): unknown {
  if (key && SENSITIVE_TELEMETRY_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactTelemetryString(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redactTelemetry(entry, undefined, seen));
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
    entryKey,
    redactTelemetry(entryValue, entryKey, seen)
  ]));
}

export function redactTelemetryString(value: string): string {
  return value.replace(BEARER_VALUE, "Bearer [REDACTED]").replace(JWT_VALUE, "[REDACTED]");
}
