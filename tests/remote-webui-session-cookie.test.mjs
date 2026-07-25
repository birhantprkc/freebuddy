import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

async function loadRemoteAuth() {
  const source = fs.readFileSync(
    new URL("../electron/remoteAuth.ts", import.meta.url),
    "utf8"
  );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  let stubbed = transpiled.replace(
    /^import \{[^}]*\} from "\.\/cli\/settings\.js";\s*$/m,
    "const getSetting = () => null; const setSetting = () => {};"
  );
  stubbed = stubbed.replace(
    /^import \{[^}]*\} from "\.\/cli\/db\.js";\s*$/m,
    "const getDb = () => { throw new Error('no db'); };"
  );
  stubbed = stubbed.replace(
    /^import \{[^}]*\} from "\.\/shared\/passwordHash\.js";\s*$/m,
    "const generateRandomPassword = () => 'x'; const hashPassword = () => 'h'; const verifyPassword = () => false;"
  );
  stubbed = stubbed.replace(
    /^export \{[^}]*\} from "\.\/shared\/passwordHash\.js";\s*$/m,
    ""
  );
  return import(
    `data:text/javascript;base64,${Buffer.from(stubbed).toString("base64")}`
  );
}

test("readSessionCookie extracts the fb_remote_token value", async () => {
  const { readSessionCookie } = await loadRemoteAuth();

  assert.equal(
    readSessionCookie("fb_remote_token=abc.def-ghi; theme=dark"),
    "abc.def-ghi"
  );
  assert.equal(readSessionCookie("theme=dark; fb_remote_token=tok123"), "tok123");
  assert.equal(readSessionCookie("fb_remote_token=token"), "token");
  assert.equal(readSessionCookie(""), null);
  assert.equal(readSessionCookie(null), null);
  assert.equal(readSessionCookie("theme=dark"), null);
});

test("buildSessionCookieHeader sets a Path=/ HttpOnly SameSite=Strict cookie", async () => {
  const { buildSessionCookieHeader } = await loadRemoteAuth();

  const header = buildSessionCookieHeader("my-token");
  assert.match(header, /^fb_remote_token=my-token/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Path=\/;/);
  assert.match(header, /Max-Age=\d+/);
});

test("webUIServer authenticates <img> requests via the session cookie and sets it on login", () => {
  const server = fs.readFileSync(
    new URL("../electron/webUIServer.ts", import.meta.url),
    "utf8"
  );
  const preload = fs.readFileSync(
    new URL("../public/web-preload.js", import.meta.url),
    "utf8"
  );
  const attachments = fs.readFileSync(
    new URL("../src/utils/chatAttachments.ts", import.meta.url),
    "utf8"
  );

  assert.match(
    server,
    /readSessionCookie\(req\.headers\.cookie\)/,
    "isAuthed must also accept the session cookie so <img> GETs can authenticate"
  );

  const loginBlock = server.slice(server.indexOf("handleLogin"));
  assert.match(
    loginBlock,
    /buildSessionCookieHeader/,
    "password login must set the session cookie"
  );
  assert.match(loginBlock, /Set-Cookie/);

  // Restored localStorage sessions never get Set-Cookie; media GETs must also
  // accept ?token= and the client must re-hydrate the HttpOnly cookie on boot.
  assert.match(server, /mediaAuthToken/);
  assert.match(server, /\/api\/session-cookie/);
  assert.match(server, /searchParams\.get\("token"\)/);
  assert.match(preload, /sessionToken:\s*function/);
  assert.match(preload, /\/api\/session-cookie/);
  assert.match(attachments, /sessionToken/);
  assert.match(attachments, /params\.set\("token"/);
});

test("unauthenticated login UI follows the host app language from /api/status", () => {
  const server = fs.readFileSync(
    new URL("../electron/webUIServer.ts", import.meta.url),
    "utf8"
  );
  const preload = fs.readFileSync(
    new URL("../public/web-preload.js", import.meta.url),
    "utf8"
  );

  assert.match(server, /getLanguage\(\)/, "status exposes the resolved app locale");
  assert.match(
    server,
    /language:\s*getLanguage\(\)/,
    "/api/status must include language for the login page"
  );
  assert.match(preload, /\/api\/status/, "login bootstrap reads host language");
  assert.match(preload, /normalizeLoginLang/, "maps zh-CN to the zh dictionary");
  assert.match(preload, /共享访问登录/, "Chinese login copy is present");
  assert.match(preload, /too_many_attempts/, "rate-limit errors are localized");
});
