# LeoParm's Apps

An independent Umbrel community app store containing **MediaDec only** (`leoparm-mediadec`). This is not an official Umbrel app-store submission.

## Compatibility and status

- Requires **umbrelOS 2.0 or newer** for configurable folder access.
- **x86_64 / linux/amd64 only.** The published image does not contain a linux/arm64 application image; ARM devices are unsupported. An attestation entry marked `unknown/unknown` is not another supported architecture. This is an intentional community-package limitation, not compliance with the official store's dual-architecture requirement.
- Package version **0.1.7-umbrel.1** identifies **MediaDec 0.1.7 + Umbrel packaging revision 1**, including the fix for testing unsaved Radarr/Sonarr connection fields and optional startup discovery. The application image is: `leoparm/mediadec:0.1.7@sha256:88ded0e831757883fdfa1a98fe39ec4914087ad94fb83a0079bc9dfae5851833`. Future packaging-only updates increment the `-umbrel.N` suffix; the prefix always matches the image's application version. The digest fixes the exact image even if its tag changes.
- This package has **not been tested through Umbrel**. The isolated Docker smoke test of the earlier 0.1.6 image verified seeded login, API authentication, settings, synthetic-video listing/rename/probing, password changes, and restart persistence. It does not prove Umbrel proxy/HTTPS behavior, folder-picker integration, or hardware acceleration. See [verification evidence](docs/verification.md).

## Installation and first use

1. In Umbrel's App Store, open the community app-store settings and add `https://github.com/dorym/umbrel_app_store`.
2. Install **MediaDec**, then open it from Umbrel. Its browser launch port is `3009`; the internal application listens on `3000`.
3. Keep **Require Umbrel login** enabled. Then sign in to MediaDec as **`admin`**, using the app password shown by Umbrel. The first-run bootstrap seeds that per-install password into an empty database, so there is no need to retrieve a generated password from logs. You can change it in MediaDec; restarts and updates preserve the changed password. Existing databases keep their existing credentials, so Umbrel's displayed initial password is not a password-reset mechanism.
4. Start with disposable copies in a **test folder**. MediaDec can **rename, rewrite, or delete** media. Keep independent backups before granting access to an existing library.
5. In MediaDec's **Umbrel Settings**, select the Media Library folder if you want to use existing storage. An external drive or network share must already be available through Umbrel. The selected folder appears inside MediaDec as **`/Media`** (case-sensitive); the app's `MEDIA_ROOT` matches it. Folder selection is writable by design for editing, not read-only library browsing.

The default mount is an empty app-private media folder, not a host-wide or NAS mount. No private network-share path, LAN IP address, NAS password, or ARR API key is included. ARR integrations are optional and configured by the user in the app, not dependencies on other Umbrel apps.

## Optional Radarr and Sonarr discovery

At **each startup**, the package checks the official Umbrel names `radarr_server_1:7878` and `sonarr_server_1:8989`. If a name resolves to an IPv4 address and its TCP port responds, its internal HTTP URL is saved **only if that URL setting is empty**. The two probes run in parallel with a 1.2-second DNS/TCP deadline per service. Failed or unavailable integrations never prevent MediaDec from starting.

- Radarr and Sonarr remain optional; neither is installed automatically or declared a mandatory dependency.
- Existing non-empty URLs, API keys, passwords, media roots, and unrelated settings are preserved. A manual URL saved while discovery is running also takes precedence.
- API keys are **not discovered or read**. Enter the URL and key in MediaDec and click **Test connection**: MediaDec 0.1.7 tests the current fields, including unsaved changes. Testing does not save settings; click **Save** to persist them for sync.
- If you install or start an integration later, restart MediaDec and reload its Settings page. This is startup discovery, not continuous monitoring.
- To replace an incorrect saved URL through discovery, clear that URL and save, then restart MediaDec. Custom names, other machines, and IPv6-only setups still need manual URLs.
- A responding TCP port establishes reachability, not API identity or authentication. Use Test connection with the current URL and API key to validate the integration.

The helper performs no Docker API/container enumeration, network scan, privileged access, or inspection of other apps' files. Actual Umbrel cross-app DNS and proxy behavior still require device-level verification.

## Data and access boundaries

| App-data path | Container path | Purpose |
| --- | --- | --- |
| `${APP_DATA_DIR}/data/db` | `/db` | SQLite settings/cache at `/db/cache.db` (`CACHE_DB_PATH`), including integration settings |
| `${APP_DATA_DIR}/data/media` | `/Media` | Default app-private media; replace via Umbrel's Media Library setting |

This is a **fresh app-data** installation, **not a migration** of any existing Docker deployment. Existing containers, databases, and media libraries are not copied or changed by these package files. Back up settings and media before any later migration; do not assume an external selected library is part of this app's backup.

The compose package uses Umbrel's proxy and network injection. It requests no raw host ports, host network, Docker socket, devices, elevated capabilities, or privileged mode. It retains the image's bundled runtime user and entrypoint; arbitrary-UID compatibility has not been established here. Treat mounted data and the shared container network as security boundaries requiring separate runtime review.

A public container image exposes compiled application code and bundled image/dependency files. Publishing an image does **not** publish external data mounts by default; any data copied into an image during its build is a separate concern. The bounded [image audit](docs/mediadec-image-audit.md) inspected every layer of the earlier 0.1.6 image (not the new 0.1.7 image) and found no user-data or service-credential leak; it documents the framework build artifacts and public self-test fixtures that triggered scanners. This is not a vulnerability or application-security certification.

## Development checks

Use Python 3.13 (or a compatible Python 3) with pinned development dependencies:

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
git diff --check
```

CI runs the offline package contracts, five first-run bootstrap tests, and thirteen optional-discovery tests in the pinned public application image, with networking disabled inside the test container. Discovery tests use synthetic DNS outcomes, real loopback TCP listeners and real SQLite; they cover missing/stopped integrations, deadlines, retries and preservation of settings. CI does not publish images or use registry credentials. The synthetic application smoke test described in `docs/verification.md` is separate. Before declaring complete Umbrel support, test a fresh install through Umbrel, both HTTP and HTTPS launch, onboarding, folder selection and update behavior. Raw Docker smoke tests are not Umbrel lifecycle verification.

## Support and licensing

Use this repository's Issues for **packaging support**. Repository and website fields point here because a canonical upstream MediaDec source repository has not been confirmed; these are not claims that this repository contains the app source.

No license grant for upstream MediaDec is made by this store. Any app-store/root license applies only to material it actually covers, not the bundled application or its dependencies; consult the upstream license and dependency notices separately before redistributing or modifying them.
