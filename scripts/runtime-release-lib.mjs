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
