# Runtime release public key

Place the production Ed25519 public key at `runtime-release.pub` in this directory
(PEM, SPKI). Desktop loads it as `runtime-prod` from:

- `process.resourcesPath/runtime-keys/runtime-release.pub` in packaged apps
- `electron/runtime/keys/runtime-release.pub` during development

Leave the file absent until the matching private key is stored in the
`maojindao55/freebuddy` Actions secret `RUNTIME_SIGNING_PRIVATE_KEY`. Runtime
auto-update stays disabled until that public key ships with a desktop release.
