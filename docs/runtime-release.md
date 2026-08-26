# Runtime Pack release

Runtime Packs are published independently of desktop installers, to a dedicated artifact repository.

| Surface | Repository | Tag | GitHub Latest |
| --- | --- | --- | --- |
| Desktop installers | `maojindao55/freebuddy` | `v*` | Desktop release (keep this as Latest) |
| Runtime Pack zips | `maojindao55/freebuddy-runtime` | `runtime-v*` | Latest Runtime in that repository |

Desktop clients never `npm install` Runtime packages. Workspace packages stay `private: true`. The distribution unit is one signed `freebuddy-runtime-<version>.zip`.

## What CI publishes

Pushing a `runtime-vX.Y.Z` tag on `maojindao55/freebuddy` runs `.github/workflows/runtime-release.yml`. That workflow:

1. Builds and Ed25519-signs the pack.
2. Stages `freebuddy-runtime-X.Y.Z.zip`, `stable.json`, and `stable.json.sig`.
3. Commits `channels/stable.json` and `channels/stable.json.sig` to `maojindao55/freebuddy-runtime` (raw GitHub URLs return HTTP 200; `releases/download` 302s, which channel fetches reject).
4. Creates a GitHub Release on `maojindao55/freebuddy-runtime` named `Runtime X.Y.Z` and uploads the zip.

The desktop repository's Latest release is not changed.

Channel JSON is fetched from:

`https://raw.githubusercontent.com/maojindao55/freebuddy-runtime/main/channels/stable.json`

The zip is downloaded from the matching GitHub Release. The downloader follows a limited number of HTTPS 302s.

Desktop Runtime auto-update stays **disabled** until the production public key is shipped with the app. Checking for updates in Settings will not download a pack while `update.enabled` is false.

## Secrets (set on `maojindao55/freebuddy`)

Add these repository Actions secrets before pushing a `runtime-v*` tag:

1. `RUNTIME_SIGNING_PRIVATE_KEY` — Ed25519 PKCS#8 PEM. GitHub secrets may use `\n` for newlines.
2. `FREEBUDDY_RUNTIME_RELEASE_TOKEN` — PAT (or GitHub App token) with `contents:write` on `maojindao55/freebuddy-runtime`. The default `GITHUB_TOKEN` cannot create releases in a different repository.

Do not print token values or persist `GH_TOKEN` / `GITHUB_TOKEN` in local shell profiles.

Generate a one-time key pair:

```sh
node --input-type=module -e "
import { generateKeyPairSync } from 'node:crypto';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
console.log(publicKey.export({ type: 'spki', format: 'pem' }).toString());
"
```

Store the private PEM in `RUNTIME_SIGNING_PRIVATE_KEY`. Commit the matching public PEM as `electron/runtime/keys/runtime-release.pub` (see that directory's README) in a **desktop** release before turning Runtime auto-update on.

## Local development

```sh
npm run runtime:build
npm run runtime:sign
npm run runtime:verify
npm run runtime:package
```

Development keys are written to `.build/runtime-keys/` and are not production keys. `npm run runtime:publish` talks to GitHub and requires `FREEBUDDY_RUNTIME_RELEASE_TOKEN`; do not run it against the desktop repository.

## First publish to the empty artifact repo

The first successful tagged run creates `README.md` and `channels/` on `maojindao55/freebuddy-runtime` if they are missing, then uploads the zip. After that, GitHub Latest in the artifact repo may point at Runtime. Desktop Latest stays on `maojindao55/freebuddy`.
