import { FramekitError } from "./errors.js";
import type { SettingDefinition } from "./schema.js";

export function validateSettingValue(definition: SettingDefinition, value: unknown): string | number | boolean {
  if (definition.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new FramekitError("INVALID_SETTING_VALUE", `${definition.key} must be a finite number`, 422, { key: definition.key, type: definition.type });
    return value;
  }
  if (definition.type === "boolean") {
    if (typeof value !== "boolean") throw new FramekitError("INVALID_SETTING_VALUE", `${definition.key} must be a boolean`, 422, { key: definition.key, type: definition.type });
    return value;
  }
  if (typeof value !== "string" || (definition.required && value.length === 0)) throw new FramekitError("INVALID_SETTING_VALUE", `${definition.key} must be a${definition.required ? " non-empty" : ""} string`, 422, { key: definition.key, type: definition.type });
  if (definition.type === "select" && !definition.options?.includes(value)) throw new FramekitError("INVALID_SETTING_VALUE", `${definition.key} must be one of its declared options`, 422, { key: definition.key, type: definition.type });
  return value;
}

export function assertSettingDefinition(definition: SettingDefinition): void {
  if (definition.type === "select") {
    if (!definition.options?.length) throw new Error(`Select setting "${definition.key}" requires options`);
    if (new Set(definition.options).size !== definition.options.length) throw new Error(`Select setting "${definition.key}" has duplicate options`);
  } else if (definition.options) {
    throw new Error(`Only select settings may declare options: "${definition.key}"`);
  }
  if (definition.type === "secret" && definition.default !== undefined) throw new Error(`Secret setting "${definition.key}" cannot declare a plaintext default`);
  if (definition.default !== undefined) validateSettingValue(definition, definition.default);
}
