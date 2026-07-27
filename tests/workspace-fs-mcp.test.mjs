import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWorkspaceFsMcpServer } from "../dist-electron/mcp/workspaceFsMcpServer.js";
import { dispatchWorkspaceFs } from "../dist-electron/workspaceFsToolService.js";

test("workspace FS MCP lists tools and enforces roots", async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  process.env.FREEBUDDY_WORKSPACE_FS_ENDPOINT =
    "http://127.0.0.1:17878/freebuddy/workspace-fs-tool";
  process.env.FREEBUDDY_WORKSPACE_FS_TOKEN = "test-token";
  globalThis.fetch = async (input, init) => {
    const parsed = JSON.parse(String(init?.body));
    calls.push({
      endpoint: String(input),
      authorization: new Headers(init?.headers).get("Authorization"),
      action: parsed.action,
      params: parsed.params
    });
    if (
      parsed.action === "read" &&
      typeof parsed.params?.path === "string" &&
      parsed.params.path.includes("outside")
    ) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Path is outside project workspace roots."
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        ok: true,
        path: parsed.params?.path,
        content: "hello",
        entries: []
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete process.env.FREEBUDDY_WORKSPACE_FS_ENDPOINT;
    delete process.env.FREEBUDDY_WORKSPACE_FS_TOKEN;
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createWorkspaceFsMcpServer();
  await server.connect(serverTransport);
  const client = new Client({ name: "freebuddy-test", version: "1.0.0" });
  await client.connect(clientTransport);
  t.after(() => client.close());
  t.after(() => server.close());

  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    ["workspace_list", "workspace_read", "workspace_write"]
  );

  const readOk = await client.callTool({
    name: "workspace_read",
    arguments: { path: "notes.md" }
  });
  assert.equal(readOk.isError, undefined);
  assert.equal(readOk.structuredContent?.content, "hello");

  const readOutside = await client.callTool({
    name: "workspace_read",
    arguments: { path: "/tmp/outside/secret.txt" }
  });
  assert.equal(readOutside.isError, true);
  assert.match(
    String(readOutside.structuredContent?.error || ""),
    /outside project workspace roots/i
  );

  assert.deepEqual(calls, [
    {
      endpoint: "http://127.0.0.1:17878/freebuddy/workspace-fs-tool",
      authorization: "Bearer test-token",
      action: "read",
      params: { path: "notes.md" }
    },
    {
      endpoint: "http://127.0.0.1:17878/freebuddy/workspace-fs-tool",
      authorization: "Bearer test-token",
      action: "read",
      params: { path: "/tmp/outside/secret.txt" }
    }
  ]);
});

test("workspaceFs dispatch read/write within secondary root", async () => {
  const primary = await fs.mkdtemp(path.join(os.tmpdir(), "fb-ws-primary-"));
  const secondary = await fs.mkdtemp(path.join(os.tmpdir(), "fb-ws-secondary-"));
  const roots = [primary, secondary];
  const binding = { roots, primary };

  const target = path.join(secondary, "nested", "note.txt");
  await fs.mkdir(path.dirname(target), { recursive: true });

  const written = await dispatchWorkspaceFs(binding, "write", {
    path: target,
    content: "from-secondary"
  });
  assert.equal(written.ok, true);
  assert.equal(written.path, target);

  const readBack = await dispatchWorkspaceFs(binding, "read", { path: target });
  assert.equal(readBack.ok, true);
  assert.equal(readBack.content, "from-secondary");

  const listed = await dispatchWorkspaceFs(binding, "list", {
    path: path.join(secondary, "nested")
  });
  assert.equal(listed.ok, true);
  assert.equal(
    listed.entries.some((entry) => entry.name === "note.txt" && entry.type === "file"),
    true
  );

  const outside = await dispatchWorkspaceFs(binding, "read", {
    path: path.join(os.tmpdir(), "fb-ws-not-a-root", "x.txt")
  });
  assert.equal(outside.ok, false);
  assert.match(String(outside.error || ""), /outside project workspace roots/i);
});

test("previewServer mounts workspace-fs-tool beside draft and browser", async () => {
  const src = await fs.readFile(
    new URL("../electron/previewServer.ts", import.meta.url),
    "utf8"
  );
  assert.match(src, /handleWorkspaceFsToolHttpRequest/);
  assert.match(src, /handleDraftToolHttpRequest/);
  assert.match(src, /handleBrowserToolHttpRequest/);
});
