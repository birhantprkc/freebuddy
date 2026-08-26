# Runtime Pack release

Runtime Packs are published independently of desktop installers.

- Desktop releases continue to use `v*` tags.
- Runtime Packs use `runtime-v*` tags and `.github/workflows/runtime-release.yml`.
- Artifacts are signed with Ed25519. Production signing requires CI secret/KMS material.
- Runtime releases must not be marked as the GitHub repository's latest desktop release.

Local development:

```sh
npm run runtime:build
npm run runtime:sign
npm run runtime:verify
```

Development keys are written to `.build/runtime-keys/` and are not production keys.
