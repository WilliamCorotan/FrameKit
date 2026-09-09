import { describe, expect, it } from "vitest";
import { createAesGcmSettingsSecrets, decodeSecretKey } from "./index.js";

describe("settings encryption keyring", () => {
  const context = { appName: "crm", scopeId: "tenant:alpha", key: "mail.password" };
  it("authenticates the ciphertext, setting identity, and key identifier", async () => {
    const provider = createAesGcmSettingsSecrets({ activeKeyId: "first", keys: { first: crypto.getRandomValues(new Uint8Array(32)) } });
    const ciphertext = await provider.seal("sensitive value 🗝", context);
    expect(ciphertext).not.toContain("sensitive");
    expect(await provider.seal("sensitive value 🗝", context)).not.toBe(ciphertext);
    await expect(provider.unseal(ciphertext, context)).resolves.toBe("sensitive value 🗝");
    await expect(provider.unseal(await provider.seal("\uFEFFpassword", context), context)).resolves.toBe("\uFEFFpassword");
    await expect(provider.seal("\uD800", context)).rejects.toMatchObject({ code: "SECRET_STORAGE_FAILED" });
    for (const changed of [{ ...context, appName: "other" }, { ...context, scopeId: "tenant:beta" }, { ...context, key: "other" }]) {
      await expect(provider.unseal(ciphertext, changed)).rejects.toMatchObject({ code: "SECRET_STORAGE_FAILED" });
    }
    const parts = ciphertext.split(".");
    const bytes = Buffer.from(parts[3]!, "base64url");
    bytes[0] = bytes[0]! ^ 1;
    parts[3] = bytes.toString("base64url");
    for (const invalid of [parts.join("."), ciphertext.replace("fksec1", "fksec2"), ciphertext + ".extra", "garbage"]) {
      await expect(provider.unseal(invalid, context)).rejects.toMatchObject({ code: "SECRET_STORAGE_FAILED" });
    }
  });

  it("supports rolling key rotation and isolates the supplied key bytes", async () => {
    const previous = crypto.getRandomValues(new Uint8Array(32));
    const original = new Uint8Array(previous);
    const active = crypto.getRandomValues(new Uint8Array(32));
    const oldProvider = createAesGcmSettingsSecrets({ activeKeyId: "old", keys: { old: previous } });
    previous.fill(0);
    const oldValue = await oldProvider.seal("rotate me", context);
    const rotating = createAesGcmSettingsSecrets({ activeKeyId: "new", keys: { old: original, new: active } });
    await expect(rotating.unseal(oldValue, context)).resolves.toBe("rotate me");
    const newValue = await rotating.seal(await rotating.unseal(oldValue, context), context);
    const retired = createAesGcmSettingsSecrets({ activeKeyId: "new", keys: { new: active } });
    await expect(retired.unseal(newValue, context)).resolves.toBe("rotate me");
    await expect(retired.unseal(oldValue, context)).rejects.toMatchObject({ code: "SECRET_STORAGE_FAILED" });
    await expect(rotating.unseal(oldValue.replace(".old.", ".new."), context)).rejects.toMatchObject({ code: "SECRET_STORAGE_FAILED" });
  });

  it("rejects invalid key configuration and noncanonical key encoding", () => {
    expect(() => createAesGcmSettingsSecrets({ activeKeyId: "missing", keys: {} })).toThrow();
    expect(() => createAesGcmSettingsSecrets({ activeKeyId: "key", keys: { key: new Uint8Array(31) } })).toThrow();
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const encoded = Buffer.from(bytes).toString("base64url");
    expect(decodeSecretKey(encoded)).toEqual(bytes);
    expect(() => decodeSecretKey(encoded + "=")).toThrow();
    expect(() => decodeSecretKey("invalid")).toThrow();
  });
});
