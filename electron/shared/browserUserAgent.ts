function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Keep the embedded browser's legacy UA compatible with Chromium web content
 * without advertising Electron or the host application's product token.
 *
 * This deliberately does not modify automation or fingerprinting APIs. It only
 * makes the ordinary User-Agent header/navigator.userAgent internally
 * consistent with Chromium's reduced-version format.
 */
export function buildBrowserCompatibleUserAgent(
  source: string,
  applicationName?: string
): string {
  const productNames = ["Electron", applicationName]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => escapeRegExp(value.trim()));
  const productPattern = new RegExp(
    `\\b(?:${productNames.join("|")})\\/[^\\s)]+`,
    "gi"
  );

  return source
    .replace(productPattern, "")
    .replace(/\bChrome\/(\d+)(?:\.\d+){3}\b/i, "Chrome/$1.0.0.0")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build the ordered locale list used by both Accept-Language and navigator.languages. */
export function buildBrowserAcceptLanguages(
  locale: string,
  preferredSystemLanguages: readonly string[]
): string {
  const languages: string[] = [];
  const add = (value: string | undefined) => {
    const normalized = value?.trim().replace(/_/g, "-");
    if (!normalized) return;
    if (!languages.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) {
      languages.push(normalized);
    }
  };

  add(locale);
  for (const language of preferredSystemLanguages) add(language);
  add(locale.split(/[-_]/)[0]);
  add("en-US");
  add("en");

  return languages.slice(0, 8).join(",");
}
