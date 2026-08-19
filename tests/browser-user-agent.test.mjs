import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBrowserAcceptLanguages,
  buildBrowserCompatibleUserAgent
} from "../dist-electron/shared/browserUserAgent.js";

test("browser UA removes Electron and app tokens and reduces the Chromium version", () => {
  const source =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) FreeBuddy/0.8.5 " +
    "Chrome/142.0.7444.175 Electron/39.2.7 Safari/537.36";

  const actual = buildBrowserCompatibleUserAgent(source, "FreeBuddy");

  assert.equal(
    actual,
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/142.0.0.0 Safari/537.36"
  );
  assert.doesNotMatch(actual, /Electron|FreeBuddy/i);
});

test("browser language list follows the app and system locales without duplicates", () => {
  assert.equal(
    buildBrowserAcceptLanguages("zh-CN", ["zh-Hans-CN", "zh-CN", "en-US"]),
    "zh-CN,zh-Hans-CN,en-US,zh,en"
  );
});
