# Localization and Typed Settings

Framekit localizes metadata with stable translation keys while retaining a required source-language label as the final fallback. Apps declare canonical BCP 47 locales, translations, and typed settings in metadata:

```ts
const app = defineApp({
  name: "Operations",
  localization: {
    defaultLocale: "en",
    supportedLocales: ["en", "fr", "fr-CA"],
    fallbackLocales: ["fr"],
    translations: { fr: { "ops.region": "Région" }, en: {} }
  },
  modules: [defineModule({
    id: "ops",
    name: "Operations",
    settings: [
      { key: "ops.region", label: "Region", labelKey: "ops.region", type: "select", options: ["us", "eu"], default: "us" },
      { key: "ops.token", label: "Token", type: "secret", required: true }
    ]
  })]
});
```

## Locale resolution

Locale tags must be canonical BCP 47 values. Resolution is deterministic: requested locale, progressively less-specific parents, configured fallbacks, then the default locale; unsupported entries are omitted and duplicates retain first occurrence. For example, `zh-Hant-TW` resolves through `zh-Hant` and `zh` when those locales are supported. Nitro honors an explicit `locale` query first, otherwise it selects the highest-quality supported `Accept-Language` candidate. `/api/meta` returns the resolved locale, supported locales, merged messages, and localized metadata for Desk and other clients.

## Setting contract

Setting definitions are unique application-wide and support `text`, `number`, `boolean`, `select`, and `secret` values. Defaults and every write are validated; corrupt persisted non-secret values fail closed when read. Tenant scope stores one value per tenant. App scope stores one shared value for the application and additionally requires `framekit.settings.app.manage` to change.

- `framekit.settings.read` lists settings through `GET /api/settings`.
- `framekit.settings.manage` writes through `PUT /api/settings/{key}`.
- The SDK exposes `meta({ locale })`, `settings({ locale })`, and `upsertSetting(key, value)`.

Public setting responses omit defaults, never contain decrypted secret values, and expose only `configured: true` plus `redacted: true` for a stored secret. Desk renders secret inputs as write-only password controls and clears them after updates.

## Secret storage boundary

Secret definitions cannot have plaintext defaults. A runtime must provide `SettingsSecretPort` before a secret can be written or resolved. `seal()` returns the opaque value persisted by the customization adapter; `unseal()` is used only by the internal `resolveSettingValue()` path. Missing ports, unprotected rows, malformed opaque values, and invalid decrypted values fail closed. Production implementations should use an authenticated encryption or managed-secret service, rotate keys independently of setting metadata, and restrict direct access to `framekit_setting_values`.
