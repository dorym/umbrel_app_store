# Tradeshow on Umbrel

## Package and image

- Package: **0.1.1-umbrel.1**, app ID `leoparm-tradeshow`.
- Pinned public image: `leoparm/tradeshow:0.1.1@sha256:804ce66897bf26772fda742e31eed8c8c35661a4f6a803773b009abcb21848fe`.
- Real platform: **linux/amd64 / x86_64 only**. The registry index's unknown/unknown entry is provenance, not arm64 support.
- Architecture image/config digest: `sha256:9e1c5a3d04c4cb4ecb869841259971a26608e70a2a8484da36603fee5dd81592`.
- Source release tag `0.1.1` identifies commit `0de68ae97d14dbdbe203ccdfad634f40e956a5f3`. The image has no version ENV/OCI label, so baked UI version verification is part of the native-image test, not inferred from its tag.
- Requires **umbrelOS 2.0** for this package's movable app-data contract. HTTPS browser port **3057**; internal server port **3000**. It does not collide with this store's MediaDec port 3009. Device-wide port availability and real Umbrel installation remain separate checks.

This is an independent community package, not an official multi-architecture App Store submission. The existing MediaDec package is retained unchanged.

## Known security issue — SEC-01

This release pins **Next.js 15.3.1**, an App Router version affected by the upstream RSC remote-code-execution advisory and subsequent source-exposure/denial-of-service advisories. **SEC-01 remains open** in the source backlog. Publishing this package does not fix the application or establish that it is safe for an untrusted environment.

Keep **Require Umbrel login** enabled. Do not expose the service directly to the Internet or publish a raw web port. Umbrel login is an outer access gate, not a dependency patch; the shared Docker network is not a trusted security boundary either. A separate dependency upgrade and validation are still needed. Market values and portfolio calculations are **not financial advice**, tax/accounting results, or trading-grade guarantees.

Official advisories:
- https://nextjs.org/blog/CVE-2025-66478
- https://nextjs.org/blog/security-update-2025-12-11

## First use

1. Refresh this community store, install **Tradeshow**, and use its HTTPS launch through Umbrel. Use the canonical device hostname, not an IP address or alternate public hostname.
2. The empty installation leads to **Create admin account**. Choose your own email and password of at least 12 characters. There is no shared/pre-seeded app login and no bootstrap that replaces an existing user's credentials.
3. Sign in with that email and password. Umbrel's displayed per-app password is not used as a Tradeshow login password; this manifest intentionally advertises no default credentials.
4. Use synthetic/disposable records first. Import CSV/JSON or supported brokerage exports through the browser. No host library, brokerage account, upload directory, database from another app, or external data mounts are attached automatically.
5. Back up your app data before upgrades or importing real financial records. Backups contain sensitive financial and authentication material; protect them accordingly.

This is a fresh app-data installation, **not a migration** of an existing deployment. No live accounts, databases, credentials, imports or other containers are copied or changed by the package. An existing installation keeps its persisted data; removing its data or installing on a different Umbrel is not a password-reset/migration procedure.

## Persistence, secret and proxy wiring

`${APP_DATA_DIR}/data` is mounted at `/app/data`. SQLite lives at `/app/data/tradeshow.db` (`SQLITE_PATH`), including its WAL/SHM companions and application-owned archived imports. The same data directory must survive container recreation and app updates. `storage.dataRoot: data` lets Umbrel relocate this directory. The committed `.gitkeep` is only empty-directory scaffolding and is removed by Umbrel.

`AUTH_SECRET` receives `${APP_SEED}`. Umbrel documents APP_SEED as a stable, per-app/per-install HMAC-derived value, appropriate for one application session secret. It is not an upstream provider credential or login password. Keeping it stable across restarts avoids intentionally rotating the session signing/encryption secret every time the container starts. No real seed is committed, printed or written into an image by this package.

`AUTH_COOKIE_NAMESPACE=leoparm-tradeshow` separates these cookies from other Tradeshow deployments on the same host. `AUTH_TRUST_HOST=true` permits the intended trusted Umbrel reverse proxy. This image did **not** preserve the public callback origin from forwarded headers alone: a native test reproduced redirects to the internal `0.0.0.0` address. The package therefore sets `AUTH_URL=https://${DEVICE_DOMAIN_NAME}:${APP_PROXY_PORT}` and `requiresHttps: true`. Umbrel opens the canonical HTTPS device hostname on port 3057; plain-HTTP login, direct IP access, alternate domains and Tor origins are not supported by this package configuration. This is a deployment configuration workaround, not a rebuilt application image or a claim that the upstream origin-detection bug is fixed. Simulated forwarded-header checks are not verification of actual Umbrel HTTPS/certificate/CSRF integration.

The package uses `app_proxy`, retains Umbrel login, and exposes no raw host port. It requests no privileged mode, host networking, devices, Docker socket, extra capabilities, broad host mounts, or another app's files. It retains the image's default runtime identity; arbitrary-UID compatibility has not been established here. There is no custom startup hook or credential-bootstrap helper.

## Verification boundaries

The registry tag/index/platform/config metadata were read anonymously. All **12 offline package contracts passed**. Against the exact pinned published image, **12 native-image tests passed**, with no failures or skips, using synthetic records and temporary SQLite state with external networking disabled. They verified baked UI version 0.1.1, all packaged migrations, manual setup through the real server action, scrypt admin creation, absence/rejection of demo credentials, CSRF/wrong-password rejection, authenticated account create/update/read/delete, namespaced Secure cookies, canonical HTTPS callbacks, server-process restart persistence, and stable-secret session behavior. Two callback-origin assertions were observed failing without AUTH_URL and passing after the canonical-HTTPS configuration was added. All task-created test containers were removed and their absence read back. These are not host-reboot or Umbrel lifecycle tests.

This package has **not been tested through Umbrel**. Raw-image tests do not prove a real app-store install, HTTP/HTTPS proxy, 2FA gate, external-storage relocation, app update/backup restoration, device-wide port availability or physical-device browser behavior. No live financial data is used for packaging checks, and **no all-layer secrets audit** of the published 0.1.1 image is claimed. The earlier source-context assessment and `.dockerignore` regression are not an audit of all image layers or historical releases.

A public container image exposes compiled application code and bundled dependencies even if the Git source repository is private. Persistent external data is separate only if it was not copied into the image at build time.

## Reproduce native-image checks

From the store repository, with Docker available:

```sh
docker run --rm --network none --entrypoint node \
  --volume "$PWD/tests/tradeshow-image.test.cjs:/tradeshow-image.test.cjs:ro" \
  leoparm/tradeshow:0.1.1@sha256:804ce66897bf26772fda742e31eed8c8c35661a4f6a803773b009abcb21848fe \
  --test /tradeshow-image.test.cjs
```

Use the repository Issues for packaging support. This store makes no license grant for upstream application code or its dependencies; consult applicable upstream notices before redistribution.
