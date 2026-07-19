# Print Drive — Instance Template

This repository is a **GitHub Template Repository**. Generating a repository from
it creates **one independent Print Drive instance**: a static, client-side
web app that lets visitors unlock an encrypted vault with a password and then
browse, preview, download, and print the files inside — with no server, no
GitHub account, and no Manager app required on the visitor's side.

> Generated from the template, this repository ships **uninitialized**: it
> contains the application and an empty vault, but no password and no files.
> Until an administrator initializes it, the site shows
> *"이 Print Drive는 아직 초기화되지 않았습니다."*

## What a visitor does

```
open the site
→ enter the Print Drive password
→ decrypt the manifest locally in the browser
→ browse files and folders
→ preview, download, or print
```

Visitors never need a GitHub account, GitHub authorization, the Manager app, or
repository access. Every decryption happens in the browser; the password never
leaves the device and is never sent anywhere.

## What an administrator does

Administrators use **Print Drive Manager** (a separate application, run on a
trusted machine, authenticated to GitHub) to initialize the instance and to add
or replace files. The Manager writes only three kinds of paths and never touches
the application source — see [docs/MANAGER_CONTRACT.md](docs/MANAGER_CONTRACT.md).

## Repository layout

| Path | Purpose |
| --- | --- |
| `index.html`, `*.js`, `styles.css`, `icon.svg`, `manifest.json`, `sw.js`, `robots.txt` | The static browser application (client-side only). |
| `crypto.js`, `logical_path.js` | Encryption-format compatibility code the browser uses. |
| `vault_format.mjs` | The Node-side encoder of the same format (used by the Manager and the init script; **never deployed**). |
| `instance.js` | The public instance-metadata contract + the browser's initialization gate. |
| `print-drive.instance.json` | Public, non-secret instance metadata. Ships as `{ "initialized": false }`. |
| `files/` | The encrypted vault. Empty until initialized; then holds `manifest.enc` and opaque `<blob-id>.bin` objects. |
| `scripts/` | Node tooling: `init_vault.mjs`, `build_dist.mjs`, `check_public_files.mjs`, `manager_paths.mjs`. |
| `tests/` | `node --test` suite. |
| `.github/workflows/deploy.yml` | GitHub Pages build + plaintext guard + deploy. |
| `docs/` | Instance format, Manager contract, and security model. |

## Initializing an instance

Print Drive Manager is the intended path. The included script is the documented
reference/fallback so the template can be initialized without it. Run it on a
**trusted machine**:

```bash
PRINT_DRIVE_PASSWORD='choose-a-strong-password' node scripts/init_vault.mjs
```

This creates the first encrypted manifest for an **empty** vault locally and
flips `print-drive.instance.json` to `initialized: true` (adding only public
values such as the generated vault ID). The password is never written to disk.
Commit `files/manifest.enc` and `print-drive.instance.json`, then push.

## Enabling GitHub Pages

In the generated repository, set **Settings → Pages → Build and deployment →
Source** to **GitHub Actions**. Every push to `main` then runs
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which:

- runs the test suite,
- runs the plaintext guard and **fails if any plaintext file is detected**,
- builds only the public web assets and encrypted output,
- stamps a build identity so the browser can confirm the deployed build,
- uploads a Pages artifact and deploys it with the official Pages action,
- uses minimum permissions and **never** receives the password or a token.

## Local development

```bash
npm run check   # plaintext / metadata guard
npm test        # node --test suite
npm run build   # produce dist/ locally
```

## Security in one paragraph

Encrypted blobs are **publicly downloadable** — anyone can fetch the ciphertext.
Confidentiality rests entirely on **password strength** and the **KDF's
resistance** to offline guessing (PBKDF2-HMAC-SHA-256). File names and logical
paths are encrypted; Git paths are opaque. There is no central Print Drive
server. See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) for the full model.
