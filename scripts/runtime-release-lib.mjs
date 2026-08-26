export function runtimeReleaseTag(version) {
  return `runtime-v${version}`;
}

export function isRuntimeTag(tag) {
  return /^runtime-v\d+\.\d+\.\d+/.test(String(tag));
}

export function versionFromRuntimeTag(tag) {
  const match = String(tag ?? "").match(/^runtime-v(\d+\.\d+\.\d+)$/);
  return match ? match[1] : null;
}

export function resolveRuntimePackVersion(env = process.env) {
  if (env.RUNTIME_PACK_VERSION && /^\d+\.\d+\.\d+/.test(env.RUNTIME_PACK_VERSION)) {
    return env.RUNTIME_PACK_VERSION;
  }
  return (
    versionFromRuntimeTag(env.RUNTIME_PACK_VERSION) ||
    versionFromRuntimeTag(env.GITHUB_REF_NAME) ||
    versionFromRuntimeTag(env.RUNTIME_RELEASE_TAG) ||
    "0.0.0-dev"
  );
}

export function runtimeReleaseRepo(env = process.env) {
  return env.RUNTIME_RELEASE_REPO || "maojindao55/freebuddy-runtime";
}

export function runtimeChannelBaseUrl(env = process.env) {
  const repo = runtimeReleaseRepo(env);
  const branch = env.RUNTIME_CHANNEL_BRANCH || "main";
  return `https://raw.githubusercontent.com/${repo}/${branch}/channels`;
}

export function normalizeSha256(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/^sha256:/i, "")
    .toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : null;
}

export function assetSha256(asset) {
  if (!asset) return null;
  return normalizeSha256(asset.digest) || normalizeSha256(asset.sha256) || null;
}

/**
 * Immutable release assets: reuse when the digest matches, fail when it differs,
 * upload only when the named asset is absent.
 */
export function decideImmutableAsset({ existingAsset, localSha256 }) {
  const local = normalizeSha256(localSha256);
  if (!local) {
    return { action: "fail", error: "local zip sha256 missing" };
  }
  if (!existingAsset) {
    return { action: "upload", localSha256: local };
  }
  const remote = assetSha256(existingAsset);
  if (remote && remote === local) {
    return { action: "reuse", localSha256: local, assetId: existingAsset.id };
  }
  if (!remote) {
    return {
      action: "compare-bytes",
      localSha256: local,
      assetId: existingAsset.id,
      url: existingAsset.browser_download_url || existingAsset.url
    };
  }
  return {
    action: "fail",
    error: `refusing to overwrite ${existingAsset.name}: existing sha256 ${remote} != ${local}`
  };
}

export function decideReleaseMutation({ release, zipName, localSha256 }) {
  if (!release) {
    return { action: "create-draft" };
  }
  const zipAsset = (release.assets ?? []).find((asset) => asset.name === zipName);
  const assetDecision = decideImmutableAsset({ existingAsset: zipAsset, localSha256 });
  if (assetDecision.action === "fail") {
    return { action: "fail", error: assetDecision.error };
  }
  if (release.draft) {
    return {
      action: "continue-draft",
      releaseId: release.id,
      zip: assetDecision
    };
  }
  if (assetDecision.action === "upload") {
    return {
      action: "fail",
      error: `published ${release.tag_name} is missing ${zipName}; refusing to mutate a published release`
    };
  }
  return {
    action: "idempotent",
    releaseId: release.id,
    zip: assetDecision
  };
}
