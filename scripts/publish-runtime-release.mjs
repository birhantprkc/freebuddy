import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveRuntimePackVersion,
  runtimeReleaseRepo,
  runtimeReleaseTag
} from "./runtime-release-lib.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, ".build", "runtime-release");
const version = resolveRuntimePackVersion();
const tag = runtimeReleaseTag(version);
const repo = runtimeReleaseRepo();
const channel = process.env.RUNTIME_RELEASE_CHANNEL || "stable";
const token = process.env.FREEBUDDY_RUNTIME_RELEASE_TOKEN || process.env.GH_TOKEN;

if (repo === "maojindao55/freebuddy" && process.env.RUNTIME_ALLOW_DESKTOP_REPO !== "1") {
  throw new Error(
    "refusing to publish Runtime artifacts to the desktop repository; set RUNTIME_RELEASE_REPO=maojindao55/freebuddy-runtime"
  );
}

if (!token) {
  throw new Error(
    "FREEBUDDY_RUNTIME_RELEASE_TOKEN is required to publish to " +
      repo +
      ". Create a PAT with contents:write on that repository and add it as a GitHub Actions secret on maojindao55/freebuddy."
  );
}

const zipName = `freebuddy-runtime-${version}.zip`;
const zipPath = path.join(outDir, zipName);
const channelPath = path.join(outDir, `${channel}.json`);
const sigPath = path.join(outDir, `${channel}.json.sig`);
for (const file of [zipPath, channelPath, sigPath]) {
  if (!fs.existsSync(file)) {
    throw new Error(`missing ${file}; run npm run runtime:package first`);
  }
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "freebuddy-runtime-release"
};

async function github(method, urlPath, body, extraHeaders = {}) {
  const response = await fetch(`https://api.github.com${urlPath}`, {
    method,
    headers: {
      ...headers,
      ...extraHeaders,
      ...(body && extraHeaders["Content-Type"] ? {} : body ? { "Content-Type": "application/json" } : {})
    },
    body: body == null ? undefined : extraHeaders["Content-Type"] ? body : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    const message = parsed?.message || text || `HTTP ${response.status}`;
    throw new Error(`${method} ${urlPath} failed: ${message}`);
  }
  return parsed;
}

const repoInfo = await github("GET", `/repos/${repo}`);
const branch = process.env.RUNTIME_CHANNEL_BRANCH || repoInfo.default_branch || "main";

async function putFile(filePath, content, message, { createOnly = false } = {}) {
  const existing = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}?ref=${encodeURIComponent(branch)}`, {
    headers
  });
  let sha;
  if (existing.ok) {
    if (createOnly) return false;
    const body = await existing.json();
    sha = body.sha;
  } else if (existing.status !== 404) {
    throw new Error(`GET ${filePath} failed: ${existing.status}`);
  }
  const payload = {
    message,
    content: Buffer.from(content).toString("base64"),
    branch
  };
  if (sha) payload.sha = sha;
  await github("PUT", `/repos/${repo}/contents/${filePath}`, payload);
  return true;
}

const readme = `# freebuddy-runtime

Signed FreeBuddy Runtime Pack artifacts. Desktop installers stay in [maojindao55/freebuddy](https://github.com/maojindao55/freebuddy/releases).

- Releases in this repository are Runtime zips, not desktop installers.
- Channel descriptors live in \`channels/stable.json\` (plus \`.sig\`).
- Do not npm-install these packages onto user machines.
`;

await putFile("README.md", readme, "docs: initialize runtime artifact repository", { createOnly: true });
await putFile(`channels/${channel}.json`, fs.readFileSync(channelPath), `chore: publish ${channel} ${tag}`);
await putFile(
  `channels/${channel}.json.sig`,
  fs.readFileSync(sigPath),
  `chore: publish ${channel} ${tag} signature`
);

let release = null;
try {
  release = await github("GET", `/repos/${repo}/releases/tags/${tag}`);
} catch {
  release = await github("POST", `/repos/${repo}/releases`, {
    tag_name: tag,
    name: `Runtime ${version}`,
    body: `FreeBuddy Runtime Pack ${version}.\n\nThis is not a desktop installer.`,
    draft: false,
    prerelease: channel !== "stable",
    make_latest: channel === "stable" ? "true" : "false"
  });
}

async function uploadAsset(filePath, name, contentType) {
  const existing = (release.assets ?? []).find((asset) => asset.name === name);
  if (existing) {
    await github("DELETE", `/repos/${repo}/releases/assets/${existing.id}`);
  }
  const bytes = fs.readFileSync(filePath);
  const response = await fetch(
    `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength)
      },
      body: bytes
    }
  );
  if (!response.ok) {
    throw new Error(`upload ${name} failed: ${response.status} ${await response.text()}`);
  }
}

await uploadAsset(zipPath, zipName, "application/zip");
await uploadAsset(channelPath, `${channel}.json`, "application/json");
await uploadAsset(sigPath, `${channel}.json.sig`, "application/octet-stream");

console.log(`published ${tag} to https://github.com/${repo}/releases/tag/${tag}`);
