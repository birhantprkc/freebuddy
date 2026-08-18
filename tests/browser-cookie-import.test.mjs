import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("browserCookieImporter exports importCookiesFromLocalBrowser and importCookiesFromJson", async () => {
  const mod = await import("../dist-electron/browserCookieImporter.js");
  assert.equal(typeof mod.importCookiesFromLocalBrowser, "function");
  assert.equal(typeof mod.importCookiesFromJson, "function");
});

test("importCookiesFromJson correctly parses Cookie-Editor formatted JSON", async () => {
  const { importCookiesFromJson } = await import("../dist-electron/browserCookieImporter.js");
  const sample = JSON.stringify([
    {
      name: "SUB",
      value: "_2A25LY",
      domain: ".weibo.com",
      path: "/",
      secure: true
    },
    {
      name: "user_session",
      value: "sess_github",
      domain: "github.com",
      path: "/"
    }
  ]);
  const result = await importCookiesFromJson(sample);
  assert.equal(result.success, true);
  assert.equal(result.count, 2);
  assert.deepEqual(result.domains.sort(), ["github.com", "weibo.com"]);
});

test("importCookiesFromJson handles malformed JSON cleanly", async () => {
  const { importCookiesFromJson } = await import("../dist-electron/browserCookieImporter.js");
  const result = await importCookiesFromJson("invalid json {}");
  assert.equal(result.success, false);
  assert.equal(result.error, "INVALID_JSON");
});
