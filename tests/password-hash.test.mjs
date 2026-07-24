import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

async function loadPasswordHash() {
  const source = fs.readFileSync(
    new URL("../electron/shared/passwordHash.ts", import.meta.url),
    "utf8"
  );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
  );
}

test("generateRandomPassword respects length and charset", async () => {
  const { generateRandomPassword } = await loadPasswordHash();
  const pw = generateRandomPassword(20);
  assert.equal(pw.length, 20);
  assert.match(pw, /^[A-Za-z0-9]+$/);
  assert.notEqual(generateRandomPassword(12), generateRandomPassword(12));
});

test("hashPassword and verifyPassword round-trip", async () => {
  const { hashPassword, verifyPassword } = await loadPasswordHash();

  const hash = hashPassword("correct horse battery staple");
  assert.match(hash, /^scrypt:[0-9a-f]+:[0-9a-f]+$/);
  assert.ok(verifyPassword("correct horse battery staple", hash));
  assert.ok(!verifyPassword("wrong password", hash));
});

test("verifyPassword rejects malformed stored hashes without throwing", async () => {
  const { verifyPassword } = await loadPasswordHash();

  assert.ok(!verifyPassword("whatever", "garbage"));
  assert.ok(!verifyPassword("whatever", "plain:abc:def"));
  assert.ok(!verifyPassword("whatever", "scrypt:nothex:zz"));
});
