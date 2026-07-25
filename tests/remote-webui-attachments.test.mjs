import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const webPreload = fs.readFileSync(
  new URL("../public/web-preload.js", import.meta.url),
  "utf8"
);

test("web selectAttachments resolves to an AttachmentCandidate[] via a browser file picker", () => {
  const start = webPreload.indexOf("selectAttachments:");
  assert.notEqual(start, -1, "selectAttachments stub must exist");
  const block = webPreload.slice(start, start + 800);

  assert.doesNotMatch(
    block,
    /return Promise\.resolve\(\s*\{\s*candidates:\s*\[\]\s*,\s*rejections:\s*\[\]\s*\}\s*\)/,
    "selectAttachments must not return the non-iterable {candidates,rejections} object " +
      "(this caused \"deferredImport.selected is not iterable\" in ChatView)"
  );

  assert.match(block, /async\s+function/, "selectAttachments must be async");
  assert.match(block, /pickAttachmentFiles/, "must delegate to the browser file picker");
  assert.match(
    block,
    /prepareAttachmentFiles/,
    "must reuse the managed upload path"
  );
  assert.match(block, /\.candidates/, "must unpack candidates from the upload result");
  assert.match(block, /return\s*\[\]/, "must resolve to an array on cancel/empty");

  const helperStart = webPreload.indexOf("function pickAttachmentFiles");
  assert.notEqual(helperStart, -1, "pickAttachmentFiles helper must exist");
  const helper = webPreload.slice(helperStart, helperStart + 800);
  assert.match(
    helper,
    /createElement\(\s*["']input["']\s*\)/,
    "picker must create an <input>"
  );
  assert.match(helper, /type\s*=\s*["']file["']/, "input must be a file picker");
  assert.match(helper, /multiple\s*=\s*true/, "picker must allow multiple files");
  assert.match(helper, /\.click\(\)/, "picker must open the dialog");
});
