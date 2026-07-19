# Print Drive Manager write contract

Print Drive Manager is a **separate application**, run by an administrator on a
trusted machine and authenticated to GitHub. It initializes an instance and
performs vault updates. This document defines exactly what the Manager is
allowed to change in a generated instance repository.

## Allowed write paths

During ordinary operation the Manager may create, replace, or delete **only**
these paths (see `scripts/manager_paths.mjs` for the machine-readable form):

```
print-drive.instance.json
files/manifest.enc
files/<opaque-blob-id>.bin        # <opaque-blob-id> = 32 lowercase hex chars
```

- `files/manifest.enc` — the authenticated encrypted manifest envelope.
- `files/<blob-id>.bin` — opaque encrypted file objects. The blob id reveals
  nothing about the file; names and paths live only inside the encrypted
  manifest.
- `print-drive.instance.json` — public, non-secret instance metadata.

`isAllowedManagerPath(path)` returns `true` for exactly these and `false` for
everything else.

## Explicitly out of bounds

During a file upload the Manager **must not** rewrite:

- application source (`index.html`, `*.js`, `styles.css`, `sw.js`, …)
- encryption-format code (`crypto.js`, `vault_format.mjs`, `logical_path.js`)
- workflows (`.github/**`), scripts, tests, or docs

Application/source changes are upgrades, reviewed and committed deliberately —
never a side effect of adding a file.

## Update ordering (commit point = manifest)

To keep the published site consistent, an update publishes encrypted objects
**before** the manifest that references them, and swaps the verified
`manifest.enc` **last**:

1. Write the new `files/<blob-id>.bin` objects.
2. Write the new `files/manifest.enc` (its authenticated `objectIndex` references
   the new objects with their ciphertext hashes).
3. Update `print-drive.instance.json` if public metadata changed.

The manifest is the commit point. A failure before step 2 leaves the previous
generation intact; orphaned objects can be pruned. The plaintext guard
(`scripts/check_public_files.mjs`) enforces that every published `*.bin` is
referenced by the authenticated `objectIndex` and that its size and SHA-256
match — so a half-published update fails the build rather than deploying.

## Confirming a deployment (build identity)

Each build writes `build-meta.json`:

```json
{
  "version": 1,
  "buildId": "<64 hex>",
  "initialized": true,
  "vault": { "version": 2, "schema": 3, "revision": 1, "manifestSha256": "<64 hex>", "objects": 3 }
}
```

The same `buildId` is stamped into `index.html` (`<meta name="print-drive-build-id">`)
and `sw.js`. `buildId` is a hash over every deployed asset **and** the encrypted
manifest, so it changes whenever the vault changes. After pushing an update, the
Manager can poll `build-meta.json` and compare `vault.manifestSha256` /
`vault.revision` to confirm that GitHub Pages has deployed the latest encrypted
update. The browser uses the same signal to drop a stale app shell.

## The Manager never asks the repository for secrets

The Pages deployment holds no password and no token. The Manager supplies the
password locally (never committed) and authenticates to GitHub with its own
credentials outside this repository. Nothing in the repository grants write
access.
