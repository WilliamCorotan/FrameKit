import type { AppDefinition, LocalizationDefinition } from "./schema.js";
import { z } from "zod";

const LocaleSchema = z.string().min(2).refine((locale) => {
  try {
    return Intl.getCanonicalLocales(locale)[0] === locale;
  } catch {
    return false;
  }
}, "Locale must be a canonical BCP 47 language tag");

export function localeFallbackChain(localization: LocalizationDefinition, requestedLocale?: string): string[] {
  const requested = requestedLocale && LocaleSchema.safeParse(requestedLocale).success ? requestedLocale : localization.defaultLocale;
  const parts = requested.split("-");
  const parents = parts.slice(1).map((_, index) => parts.slice(0, parts.length - index - 1).join("-"));
  return [...new Set([requested, ...parents, ...localization.fallbackLocales, localization.defaultLocale].filter((locale) => localization.supportedLocales.includes(locale)))];
}

export function resolveTranslation(app: AppDefinition, key: string | undefined, fallback: string | undefined, requestedLocale?: string): string | undefined {
  if (!key) return fallback;
  for (const locale of localeFallbackChain(app.localization, requestedLocale)) {
    const translated = app.localization.translations[locale]?.[key];
    if (translated !== undefined) return translated;
  }
  return fallback;
}

export function assertLocalization(app: AppDefinition): void {
  const localization = app.localization;
  if (new Set(localization.supportedLocales).size !== localization.supportedLocales.length) throw new Error("Localization supportedLocales must be unique");
  if (!localization.supportedLocales.includes(localization.defaultLocale)) throw new Error("Localization defaultLocale must be supported");
  for (const locale of localization.fallbackLocales) {
    if (!localization.supportedLocales.includes(locale)) throw new Error(`Localization fallback locale "${locale}" must be supported`);
  }
  for (const locale of Object.keys(localization.translations)) {
    if (!localization.supportedLocales.includes(locale)) throw new Error(`Translations provided for unsupported locale "${locale}"`);
  }
}
