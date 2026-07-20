# Instance metadata format

`print-drive.instance.json` is the machine-readable initialization contract
between a Print Drive instance and Print Drive Manager. It is **public and
non-secret**: it is served on GitHub Pages and committed to the repository.

## Before initialization

The template ships exactly:

```json
{
  "formatVersion": 1,
  "application": "print-drive",
  "initialized": false
}
```

The browser's initialization gate (`instance.js`) fetches this file on load. When
`initialized` is not `true`, the site shows the not-yet-initialized notice
instead of the password form.

## After initialization

Print Drive Manager (or `scripts/init_vault.mjs`) replaces or extends the file
with **public, non-secret** values only. Example:

```json
{
  "formatVersion": 1,
  "application": "print-drive",
  "initialized": true,
  "vaultId": "0123456789abcdef0123456789abcdef",
  "vaultFormatVersion": 2,
  "owner": "example-owner",
  "repo": "print-drive-instance",
  "branch": "main",
  "pagesUrl": "https://example-owner.github.io/print-drive-instance/",
  "initializedAt": "2026-07-19T00:00:00.000Z"
}
```

Recognized public fields the Manager may set: `vaultId`, `owner`, `repo`,
`branch`, `pagesUrl`, `vaultFormatVersion`, `initializedAt`. Additional public
fields are permitted as long as they carry no secret.

## Forbidden values

The file must **never** contain any of the following, at any nesting depth:

- vault password or passphrase
- vault key or any file key (DEK)
- GitHub token / personal access token
- plaintext file names or logical paths
- client secret or private key

`instance.js` (`assertNoInstanceSecrets`) and the plaintext guard reject any key
matching a secret-bearing name (`password`, `passphrase`, `secret`, `token`,
`credential`, `privateKey`, `vaultKey`, `clientSecret`, …). A file that carries
such a key fails the build.

## Lifecycle rules enforced by the build

- `initialized: true` **requires** `files/manifest.enc` to be present.
- `initialized: false` **forbids** any `files/manifest.enc` or `*.bin` object.
- `application` must equal `"print-drive"`; `formatVersion` must equal `1`.

A structurally invalid file (wrong `application`/`formatVersion`, or a secret
key) is treated as a **deployment error**, not as an "uninitialized" state, so a
misconfiguration cannot silently masquerade as a fresh instance.
