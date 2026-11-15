# MediaDec image sensitive-information audit

Audit completed: 2026-11-15 (UTC).

## Artifact and scope

The audited image was **already public** on Docker Hub. This store references it; it does not publish a new application image or publish an upstream source repository.

```text
leoparm/mediadec:0.1.6@sha256:bc18bb01dcf90925261c5ac8bd4ba8fffb95a80fbb0819a13417c8a9b9beb4fe
```

Anonymous registry requests verified the tag/index digest and the linux/amd64 platform manifest. Its config digest matched the exact image inspected/exported from Docker. The index contains an amd64 application and provenance metadata, not an arm64 application.

The inspection covered the image configuration, build history, and **every archived image layer**, including files from older layers. It did **not** read live database or media mounts. Application code inside a public image is exposed even if the corresponding source repository is private.

## Method

- Export the exact image into restricted local storage; never put archive bytes or raw scan results into chat.
- Inspect regular files in each layer without following archive-supplied links or extracting special files onto the host.
- Check application SQLite signatures, environment files, repository metadata, private-key payloads, package-manager authentication, and credential-named image environment/build arguments.
- Run **Gitleaks 8.30.1**, downloaded from its upstream release and checked against the published archive checksum. A positive synthetic-token control and a negative control both passed.
- Scan with no target-file size cap, nested archive depth 2 and decode depth 5. A recheck with inherited Gitleaks configuration removed produced the same findings.
- Keep matches and file-level reports private. Validate suspected private keys locally and compare dependency fixtures against matching upstream source before classifying them.

## Findings

No application database file, `.env` file, Git repository metadata, npm authentication value, credential-named image environment variable, or credential assignment in build history was detected by these checks.

The scanner and file checks did identify artifacts that require context:

1. **Next.js preview signing/encryption values.** These are generated framework build artifacts in the prerender manifest and cached preview information. They are not the owner's ARR API keys or database credentials. The inspected app route inventory did not contain a preview-enabling route. The values are nevertheless visible to anyone downloading the image; do not reuse build-time keys as application secrets.
2. **GnuTLS self-test keys.** Some PEM payloads in the bundled library were structurally valid private keys. Their bytes matched the publicly distributed GnuTLS 3.7.9 cryptographic self-test fixtures. They were not user-specific private keys.
3. **System-header matches and npm configuration.** The remaining generic-key matches were header-code false positives. The npm configuration candidate did not contain authentication directives with credential values.

No unresolved user-secret leak was identified in the inspected artifact. This is a bounded finding, not proof that no possible secret or encoded/encrypted data exists.

## Runtime credentials and data

Upstream MediaDec creates a random initial admin password at runtime and writes it to logs; that password is not a pre-existing image credential. This package seeds an empty credentials table with Umbrel's per-install password before MediaDec starts. It never logs that password, and it does not reset existing credentials. It removes the bootstrap password variable from the child application's environment before starting the app.

After installation, the SQLite database can contain authentication and integration settings. Treat `${APP_DATA_DIR}/data/db` and its backups as sensitive. User-selected media is writable by design. Neither belongs in a public repository or an image build context.

## Limits

This was **not** a CVE/dependency-vulnerability scan, penetration test, source-code security review, exhaustive data-loss analysis, or certification of authentication/authorization correctness. Secret scanners and bounded decoding can miss things. Scan again whenever the pinned digest changes.

No production media, credentials, databases, raw findings, or image archives are committed to this repository.

## Primary references

- [Gitleaks](https://github.com/gitleaks/gitleaks)
- [GnuTLS 3.7.9 public-key self-test fixtures](https://github.com/gnutls/gnutls/blob/3.7.9/lib/crypto-selftests-pk.c)
- [Umbrel packaging guidance](https://github.com/getumbrel/umbrel-apps/blob/master/.agents/skills/umbrel-package-app/SKILL.md)
