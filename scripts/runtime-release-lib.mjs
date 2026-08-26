export function runtimeReleaseTag(version) {
  return `runtime-v${version}`;
}

export function isRuntimeTag(tag) {
  return /^runtime-v\d+\.\d+\.\d+/.test(tag);
}
