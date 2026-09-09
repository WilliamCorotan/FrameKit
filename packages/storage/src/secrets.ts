import { FramekitError } from "@framekit/core";
import type { SettingsSecretPort } from "@framekit/runtime";

export type SettingsKeyringOptions = {
  activeKeyId: string;
  /** 32 random bytes per key. Retain previous keys until all values have been re-encrypted. */
  keys: Readonly<Record<string, Uint8Array>>;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const keyIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
const maximumBytes = 1024 * 1024;

export function decodeSecretKey(value: string): Uint8Array {
  const bytes = decode(value);
  if (bytes.length !== 32) throw new Error("A settings encryption key must contain exactly 32 random bytes encoded as base64url.");
  return bytes;
}

export function createAesGcmSettingsSecrets(options: SettingsKeyringOptions): SettingsSecretPort {
  if (!keyIdPattern.test(options.activeKeyId)) throw new Error("Invalid active settings key identifier.");
  const keys = new Map<string, Promise<CryptoKey>>();
  for (const [id, value] of Object.entries(options.keys)) {
    if (!keyIdPattern.test(id) || !(value instanceof Uint8Array) || value.byteLength !== 32) {
      throw new Error("Settings key identifiers must be URL-safe and each key must contain exactly 32 random bytes.");
    }
    keys.set(id, crypto.subtle.importKey("raw", new Uint8Array(value), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]));
  }
  if (!keys.has(options.activeKeyId)) throw new Error("The active settings encryption key is missing from the keyring.");
  const activeKeyId = options.activeKeyId;
  const additionalData = (id: string, context: Parameters<SettingsSecretPort["seal"]>[1]) =>
    encoder.encode(JSON.stringify(["framekit.settings.v1", id, context.appName, context.scopeId, context.key]));

  return {
    async seal(value, context) {
      const bytes = encoder.encode(value);
      if (bytes.byteLength > maximumBytes || decoder.decode(bytes) !== value) throw storageError();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: additionalData(activeKeyId, context), tagLength: 128 }, await keys.get(activeKeyId)!, bytes);
      return `fksec1.${activeKeyId}.${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
    },
    async unseal(value, context) {
      try {
        if (value.length > 2 * maximumBytes) throw storageError();
        const parts = value.split(".");
        const [version, id, encodedIv, encodedValue] = parts;
        if (parts.length !== 4 || version !== "fksec1" || !id || !keys.has(id) || !encodedIv || !encodedValue) throw storageError();
        const iv = decode(encodedIv);
        const encrypted = decode(encodedValue);
        if (iv.byteLength !== 12 || encrypted.byteLength < 16 || encrypted.byteLength > maximumBytes + 16) throw storageError();
        const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: additionalData(id, context), tagLength: 128 }, await keys.get(id)!, encrypted);
        return decoder.decode(decrypted);
      } catch {
        throw storageError();
      }
    }
  };
}

function storageError(): FramekitError {
  return new FramekitError("SECRET_STORAGE_FAILED", "Secret storage operation failed.", 503);
}

function encode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url value.");
  const bytes = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (character) => character.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error("Non-canonical base64url value.");
  return bytes;
}
