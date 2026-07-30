import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

async function load() {
  const source = fs.readFileSync(
    new URL("../electron/shared/logSanitize.ts", import.meta.url),
    "utf8"
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("redactsecrets masks sk- keys keeping a 6-char prefix", async () => {
  const { redactsecrets } = await load();
  assert.equal(
    redactsecrets("key is sk-ant-abc123def456ghi789"),
    "key is sk-ant…<redacted>"
  );
});

test("redactsecrets masks bearer tokens and key=value secrets", async () => {
  const { redactsecrets } = await load();
  assert.equal(redactsecrets("Bearer abcdef1234567890"), "Bearer <redacted>");
  assert.equal(redactsecrets('api_key="supersecretvalue123"'), 'api_key="<redacted>"');
  assert.equal(redactsecrets("short: abc"), "short: abc"); // < 8 chars untouched
});

test("buildPathMasks sorts longest-first so userData beats home", async () => {
  const { buildPathMasks, maskPaths } = await load();
  const masks = buildPathMasks({
    home: "/Users/alice",
    userData: "/Users/alice/Library/Application Support/freebuddy",
    workspaces: ["/Users/alice/code/proj"]
  });
  assert.equal(
    maskPaths("cwd=/Users/alice/code/proj db in /Users/alice/Library/Application Support/freebuddy/x", masks),
    "cwd=<workspace> db in <appdata>/x"
  );
  assert.equal(maskPaths("home is /Users/alice/other", masks), "home is <home>/other");
});

test("sanitizeLogData redacts content keys with length marker and masks paths", async () => {
  const { sanitizeLogData, buildPathMasks } = await load();
  const masks = buildPathMasks({ home: "/h", userData: "/h/app", workspaces: [] });
  const out = sanitizeLogData(
    { content: "hello world", prompt: 42, cwd: "/h/work", note: "ok" },
    masks
  );
  assert.equal(out.content, "<redacted: 11 chars>");
  assert.equal(out.prompt, 42); // non-string content values pass through
  assert.equal(out.cwd, "<home>/work");
  assert.equal(out.note, "ok");
});

test("filterSessionLogLine full mode only redacts secrets", async () => {
  const { filterSessionLogLine } = await load();
  const line = JSON.stringify({ ts: "t", type: "stdin", content: "sk-ant-abc123def456" });
  const out = JSON.parse(filterSessionLogLine(line, "full", []));
  assert.equal(out.content, "sk-ant…<redacted>");
  assert.equal(out.type, "stdin");
});

test("filterSessionLogLine standard keeps system/stderr with path masks", async () => {
  const { filterSessionLogLine, buildPathMasks } = await load();
  const masks = buildPathMasks({ home: "/h", userData: "/h/app", workspaces: ["/h/w"] });
  const sys = JSON.stringify({ ts: "t", type: "system", content: "start adapter=codex cwd=/h/w" });
  assert.equal(
    JSON.parse(filterSessionLogLine(sys, "standard", masks)).content,
    "start adapter=codex cwd=<workspace>"
  );
  const err = JSON.stringify({ ts: "t", type: "stderr", content: "boom at /h/app/x" });
  assert.equal(JSON.parse(filterSessionLogLine(err, "standard", masks)).content, "boom at <appdata>/x");
});

test("filterSessionLogLine standard strips stdin/stdout payloads but keeps event, error, usage", async () => {
  const { filterSessionLogLine } = await load();
  const payload = JSON.stringify({
    msg: { type: "assistant", text: "private reply", usage: { input_tokens: 1200, output_tokens: 55 } }
  });
  const line = JSON.stringify({ ts: "t", type: "stdout", content: payload });
  const out = JSON.parse(filterSessionLogLine(line, "standard", []));
  assert.equal(out.event, "assistant");
  assert.deepEqual(out.usage, { input_tokens: 1200, output_tokens: 55 });
  assert.equal(out.content, `<redacted: ${payload.length} chars>`);
  assert.ok(!JSON.stringify(out).includes("private reply"));
});

test("filterSessionLogLine standard keeps agent error messages like Compacting failed", async () => {
  const { filterSessionLogLine } = await load();
  const line = JSON.stringify({
    ts: "t",
    type: "stdout",
    content: JSON.stringify({ error: { code: -32603, message: "Compacting failed: aborted" } })
  });
  const out = JSON.parse(filterSessionLogLine(line, "standard", []));
  assert.equal(out.error, "Compacting failed: aborted");
  assert.equal(out.errorCode, -32603);
});

test("filterSessionLogLine standard replaces unparseable lines with a length marker", async () => {
  const { filterSessionLogLine } = await load();
  const out = JSON.parse(filterSessionLogLine("not json at all", "standard", []));
  assert.equal(out.type, "unparsed");
  assert.equal(out.content, "<redacted: 15 chars>");
});

test("filterOwnLogLine standard sanitizes data and msg, full keeps content", async () => {
  const { filterOwnLogLine, buildPathMasks } = await load();
  const masks = buildPathMasks({ home: "/h", userData: "/h/app", workspaces: [] });
  const line = JSON.stringify({ ts: "t", level: "error", scope: "chat", msg: "failed in /h/w", data: { content: "secret text" } });
  const std = JSON.parse(filterOwnLogLine(line, "standard", masks));
  assert.equal(std.msg, "failed in <home>/w");
  assert.equal(std.data.content, "<redacted: 11 chars>");
  const full = JSON.parse(filterOwnLogLine(line, "full", masks));
  assert.equal(full.data.content, "secret text");
});
