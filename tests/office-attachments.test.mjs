import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const OFFICE_CASES = [
  ["doc", "application/msword"],
  [
    "docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ],
  ["xls", "application/vnd.ms-excel"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["ppt", "application/vnd.ms-powerpoint"],
  [
    "pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ]
];

async function loadManagedBufferValidation() {
  const source = fs.readFileSync(
    new URL("../electron/shared/managedBufferValidation.ts", import.meta.url),
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

async function loadChatAttachments() {
  const source = fs.readFileSync(
    new URL("../src/utils/chatAttachments.ts", import.meta.url),
    "utf8"
  );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  const stubbed = transpiled.replace(
    /^import i18next from "i18next";\s*$/m,
    'const i18next = { t: (k) => k };'
  );
  return import(
    `data:text/javascript;base64,${Buffer.from(stubbed).toString("base64")}`
  );
}

test("resolveManagedBufferAttachment accepts Office documents by name + mime", async () => {
  const { resolveManagedBufferAttachment } = await loadManagedBufferValidation();
  const arbitrary = Buffer.from("not-real-office-content");

  for (const [ext, mime] of OFFICE_CASES) {
    assert.deepEqual(
      resolveManagedBufferAttachment(`report.${ext}`, mime, arbitrary),
      { extension: ext, mimeType: mime },
      `${ext} with its official mime should be accepted`
    );
    assert.deepEqual(
      resolveManagedBufferAttachment(`report.${ext}`, "application/octet-stream", arbitrary),
      { extension: ext, mimeType: mime },
      `${ext} with octet-stream mime should be accepted via filename`
    );
  }
});

test("classifyAttachmentPath classifies Office extensions as documents", async () => {
  const { classifyAttachmentPath } = await loadChatAttachments();

  for (const [ext, mime] of OFFICE_CASES) {
    assert.deepEqual(
      classifyAttachmentPath(`/tmp/report.${ext}`),
      { kind: "document", extension: ext, mimeType: mime },
      `${ext} should classify as a document`
    );
  }
});

test("all attachment whitelists and the web picker accept Office extensions", () => {
  const officeExt = OFFICE_CASES.map(([ext]) => ext);

  const sources = {
    managedBuffer: fs.readFileSync(
      new URL("../electron/shared/managedBufferValidation.ts", import.meta.url),
      "utf8"
    ),
    attachments: fs.readFileSync(
      new URL("../electron/cli/attachments.ts", import.meta.url),
      "utf8"
    ),
    ipc: fs.readFileSync(
      new URL("../electron/cli/ipc.ts", import.meta.url),
      "utf8"
    ),
    chatAttachments: fs.readFileSync(
      new URL("../src/utils/chatAttachments.ts", import.meta.url),
      "utf8"
    ),
    webPreload: fs.readFileSync(
      new URL("../public/web-preload.js", import.meta.url),
      "utf8"
    )
  };

  for (const ext of officeExt) {
    assert.match(
      sources.managedBuffer,
      new RegExp(`"\\b${ext}\\b"`),
      `managedBufferValidation must whitelist .${ext}`
    );
    assert.match(
      sources.attachments,
      new RegExp(`"\\b${ext}\\b"`),
      `attachments.ts must whitelist .${ext}`
    );
    assert.match(
      sources.ipc,
      new RegExp(`"\\b${ext}\\b"`),
      `ipc.ts must whitelist .${ext} (dialog filter)`
    );
    assert.match(
      sources.chatAttachments,
      new RegExp(`\\b${ext}:\\s*"`),
      `chatAttachments DOCUMENT_MIME must map .${ext}`
    );
    assert.match(
      sources.webPreload,
      new RegExp(`\\.${ext}`),
      `web-preload accept attribute must include .${ext}`
    );
  }

  const picker = sources.webPreload.slice(
    sources.webPreload.indexOf("function pickAttachmentFiles")
  );
  assert.match(
    picker,
    /input\.accept\s*=/,
    "web file picker must set an accept attribute"
  );
});
