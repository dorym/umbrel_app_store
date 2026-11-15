# Verification evidence

Verification date: 2026-11-15 (UTC).

## Static package contracts

`python -m unittest discover -s tests -v`: **6 passed**. Contracts check the sole MediaDec app, store/app IDs, stable digest-pinned image, proxy, writable folder declaration, persistence scaffolding, generated-login/bootstrap wiring, icon, and CI permissions. `node --check` also passed for the bootstrap template.

The credential-wiring assertions were observed failing before implementation, then passing after implementation. A separate failing CI contract preceded the bootstrap test job.

## Bootstrap and optional-discovery tests in the exact application image

For Umbrel package **0.1.7**, `tests/bootstrap.test.cjs` and `tests/discovery.test.cjs` ran inside the unchanged audited linux/amd64 application image using its actual `better-sqlite3` dependency: **18 passed, 0 failed**. The five credential tests verify:

- First-install seeding and password hashing, without logging the password.
- Existing changed credentials and settings survive rerunning the bootstrap.
- A missing first-install password fails without creating an account.
- A short first-install password fails without being logged.
- An invalid database path fails without disclosing the password.

The thirteen discovery tests verify reachable-only URL defaults, preservation of manual URLs/API keys/unrelated settings, unavailable integrations, independent detection, discovery on a later startup, concurrent manual saves, rejected probes, missing storage, successful optional CLI exit, real loopback TCP reachability, DNS failure/deadline cancellation and refused ports. The first discovery test was observed failing because the helper was missing before implementation. Tests use synthetic resolver results and real loopback listeners, not live Radarr/Sonarr instances or API keys. The helper checks reachability; authenticated API testing remains a separate user action.

Reproduce with Docker:

```sh
docker run --rm --network none --entrypoint node \
  --volume "$PWD/leoparm-mediadec/bootstrap.cjs.template:/bootstrap.cjs:ro" \
  --volume "$PWD/leoparm-mediadec/discovery.cjs.template:/discovery.cjs:ro" \
  --volume "$PWD/tests/bootstrap.test.cjs:/bootstrap.test.cjs:ro" \
  --volume "$PWD/tests/discovery.test.cjs:/discovery.test.cjs:ro" \
  leoparm/mediadec:0.1.6@sha256:bc18bb01dcf90925261c5ac8bd4ba8fffb95a80fbb0819a13417c8a9b9beb4fe \
  --test /bootstrap.test.cjs /discovery.test.cjs
```

The container writes only disposable synthetic test databases in its temporary filesystem. No registry credentials or live data are needed.

## Isolated application smoke test

A separate network-disabled Docker container used fresh test volumes, synthetic credentials and a generated test video. It used the package's exact bootstrap content and startup command, against the audited image. Verified through loopback HTTP inside that container:

- Admin login with the supplied synthetic Umbrel password.
- Unauthenticated file API requests rejected.
- Synthetic video listing, rename and ffprobe track inspection.
- Settings save and readback.
- Password change; the old password is rejected.
- Restart preserves the changed password, saved settings and renamed video.
- Bootstrap does not overwrite existing credentials and fails closed without a first-install password.

No live library or application database was mounted. Source-host synthetic application workloads were stopped after verification, and the live source deployment baseline was unchanged during the successful smoke test.

Earlier attempts exposed harness issues rather than validated behavior: test-volume ownership was initially unsuitable for a forced UID, and host-published test ports were unavailable. The successful test used the image's default runtime user, initialized isolated state and no published host port. The package does not force an unverified arbitrary runtime UID.

## Not verified

**This is not an Umbrel lifecycle test.** The package has not been installed via the Umbrel App Store UI or lifecycle API. The following still require a real Umbrel install:

- Community-store rendering and installation.
- HTTP/HTTPS routing through Umbrel's proxy and login.
- The displayed app password and Media Library folder picker.
- Upgrade behavior across Umbrel package versions.
- Hardware acceleration and substantial transcoding workflows.

The public image is amd64-only; no ARM runtime is claimed. The official Umbrel repository's full linter was not run; the checks above are this store's explicit contracts, not a substitute for official certification.

## Destination test-resource limitation

An earlier destination-host test was interrupted when its TLS certificate no longer matched the approved pin. That replacement was not trusted automatically. The final successful tests ran on the source Docker host instead. A temporary destination test container and its synthetic volumes may remain; their final cleanup state could not be verified through the now-untrusted connection. They are not an app-store installation or a copy of real media.

## CI

The workflow runs the six Python package contracts and eighteen Node credential/discovery tests in the pinned public image. It has read-only repository permissions and does not publish images. Workflow results must be checked separately; this document is not a claim that a future GitHub Actions run passed.
