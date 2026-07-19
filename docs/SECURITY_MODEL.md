# Security model

## One-sentence summary

Print Drive publishes **publicly downloadable ciphertext**; confidentiality
depends entirely on **password strength** and the **KDF's resistance** to
offline guessing, because there is no server to rate-limit or revoke access.

## Trust boundaries

- **Visitor** — needs only the Print Drive password. Decryption is
  **client-side only**; the password never leaves the browser and is never
  transmitted. No GitHub account or authorization is required.
- **Administrator** — uses Print Drive Manager on a trusted machine with GitHub
  credentials to initialize the instance and publish encrypted updates.
- **GitHub Pages / the repository** — treated as an **untrusted public host**.
  It stores and serves ciphertext and public metadata. It never holds the
  password, any key, or a token.

There is **no central Print Drive server**. The static site plus the encrypted
vault is the entire system.

## What is protected

- **File contents** — AES-256-GCM authenticated encryption (12-byte IV,
  128-bit tag).
- **File names and logical folder paths** — stored only inside the encrypted
  manifest. They are never in cleartext on the host.
- **Git paths** — opaque `files/<32-hex>.bin`. A blob id reveals nothing about
  the file it holds.

Authenticated encryption means tampering with a blob or the manifest is
detected on decryption rather than yielding corrupt output.

## What is *not* protected

- **The ciphertext is public.** Anyone who can reach the site can download every
  `*.bin` object and the manifest. Security is not access control; it is the
  cost of breaking the KDF + cipher.
- **Metadata leakage.** The public `objectIndex` reveals the **number** of
  objects and each object's **encrypted size**. Padding (configurable block
  size) blunts size inference but does not eliminate it.
- **Password compromise.** Anyone with the password can read the vault. Because
  Git history retains old key slots, rotating the password does not retroactively
  revoke access to previously published ciphertext. Responding to a compromised
  password requires re-encrypting the vault under a new key/generation and
  isolating the old deployment.

## Key derivation and format

- Password → key-encryption key: **PBKDF2-HMAC-SHA-256** with a random 32-byte
  salt and a high iteration count.
- A random 32-byte vault key is wrapped per password slot; per-file data keys
  (DEKs) are wrapped under an HKDF-SHA-256 subkey of the vault key.
- Additional authenticated data binds each ciphertext to its identity (vault id,
  logical id, blob id, sizes), so objects cannot be swapped between contexts.

The format is the stable, validated Print Drive v2 format. This template reuses
its compatibility code (`crypto.js` in the browser, `vault_format.mjs` on the
Node side) unchanged, and copies **no** personal vault identifiers or encrypted
objects. See [INSTANCE_FORMAT.md](INSTANCE_FORMAT.md) and
[MANAGER_CONTRACT.md](MANAGER_CONTRACT.md).

## Guardrails in this repository

- The Pages workflow runs a **plaintext guard** that fails the build if any file
  under `files/` is not `manifest.enc` or an opaque `*.bin`, or if a blob is
  unreferenced or hash-mismatched, or if the instance metadata carries a
  secret-bearing key.
- The site serves a strict **Content-Security-Policy** (`default-src 'self'`, no
  third-party origins) and a `no-referrer` policy.
- The generated site exposes **no administrative setup form**; initialization
  and updates happen only through the Manager / local tooling.
- The template ships **uninitialized** with **no password** and **no files**.

## Choosing a password

Because offline guessing is the primary attack, use a long, high-entropy
password (a passphrase of several random words, or a password-manager-generated
secret). Short or reused passwords undermine the entire model.
