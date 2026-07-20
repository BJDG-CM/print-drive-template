# Print Drive — Instance Template

This is a **GitHub Template Repository**. Use it to create your own independent
**Print Drive** instance: a static, client-side site where visitors unlock an
encrypted vault with a password and then browse, preview, download, and print
the files inside — with no server and no GitHub account on the visitor's side.

A new repository made from this template ships **uninitialized**: it contains
the app and an empty vault, but no password and no files. Until an administrator
initializes it, the site shows a short "not initialized yet" notice.

## Who needs what

| Role | Needs | Does not need |
| --- | --- | --- |
| **Visitor** | the site URL and the vault password | a GitHub account, GitHub login/OAuth, repository access, the Manager, any server |
| **Administrator** | GitHub (to own the repo) and **Print Drive Manager** (to initialize and update the vault) | to share their password with the repo, Pages, or the workflow |

Decryption happens entirely in the visitor's browser. The password is never sent
anywhere and is never stored in the repository, on Pages, or in the workflow.

## Set up your own instance

```
Use this template
→ create a new repository
→ Settings → Pages → Build and deployment → Source: GitHub Actions
→ initialize the vault (Print Drive Manager, or the fallback init script)
→ push files/manifest.enc and print-drive.instance.json
→ confirm the deployment went out
→ give visitors the site URL and the vault password
```

### 1. Create the repository

Click **Use this template → Create a new repository**. Nothing in the template
is owner-specific, so the copy is ready to initialize.

### 2. Turn on Pages

In the new repository: **Settings → Pages → Build and deployment → Source →
GitHub Actions**. Pushes to `main` then build and deploy automatically.

### 3. Initialize the vault

Print Drive Manager is the intended tool. A fallback script is included so you
can initialize without it, on a **trusted machine**:

```bash
PRINT_DRIVE_PASSWORD='choose-a-strong-password' node scripts/init_vault.mjs
```

This creates the first encrypted manifest for an **empty** vault locally and
flips `print-drive.instance.json` to `initialized: true`, adding only public
values (such as the generated vault ID). The password is never written to disk.
Commit `files/manifest.enc` and `print-drive.instance.json`, then push.

### 4. Confirm the deployment

After the deploy workflow finishes, open the Pages URL. `build-meta.json`
reports the deployed build id and (once initialized) the vault revision and
manifest hash, so you can confirm the latest encrypted update is live.

### 5. Share access

Give visitors the **site URL** and the **vault password** over a trusted
channel. That is all a visitor ever needs.

## Two things that are separate

- **File updates** — adding or replacing files in the vault. Print Drive Manager
  writes only `files/manifest.enc`, `files/<blob>.bin`, and
  `print-drive.instance.json`. It **never modifies the application source**. See
  [docs/MANAGER_CONTRACT.md](docs/MANAGER_CONTRACT.md).
- **Application upgrades** — pulling newer app/format/workflow code. These are
  deliberate, reviewed commits, not a side effect of adding a file.

The deploy workflow keeps these fast and safe: an update that touches only
`files/**` or `print-drive.instance.json` takes a fast path (payload
verification + build + deploy); any change to app/source/scripts/tests/docs/
workflow takes the full path (all checks + the test suite) before deploying.

## Public vs. private

- **The repository's visibility** (public or private) is your choice and is
  separate from the next point.
- **The encrypted blobs are effectively public.** Anyone who can reach the
  deployed site can download the ciphertext and the manifest. Confidentiality
  does **not** come from access control — it comes from your password.

## Choose a strong password

Because the ciphertext is downloadable, the only thing standing between it and a
reader is the password and the key-derivation cost of guessing it. Use a long,
high-entropy passphrase or a password-manager secret. **There is no server that
can reset or recover a forgotten password** — losing it means losing access to
the vault. See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

## Themes and accessibility

The site supports **system / light / dark** themes (default: system, following
the OS). The choice is stored locally only, applies to every screen, and
survives a public-device cleanup. No external fonts, frameworks, or icon
packages are used.

## Local development

```bash
npm run check   # plaintext / metadata guard
npm test        # node --test suite
npm run build   # produce dist/ locally
npm run verify  # check + test + build
```

## Repository layout

| Path | Purpose |
| --- | --- |
| `index.html`, `*.js`, `styles.css`, `sw.js`, `manifest.json`, `icon.svg`, `robots.txt` | The static browser application (client-side only). |
| `crypto.js`, `logical_path.js` | Encryption-format compatibility code the browser uses. |
| `theme.js`, `instance.js` | Theme controller and the public instance-metadata / initialization gate. |
| `vault_format.mjs` | Node-side encoder of the same format (Manager + init script; **never deployed**). |
| `print-drive.instance.json` | Public, non-secret instance metadata. Ships as `{ "initialized": false }`. |
| `files/` | The encrypted vault. Empty until initialized. |
| `scripts/` | Node tooling: `init_vault.mjs`, `build_dist.mjs`, `check_public_files.mjs`, `deploy_scope.mjs`, `manager_paths.mjs`. |
| `tests/` | `node --test` suite. |
| `.github/workflows/deploy.yml` | Fast/full Pages build + plaintext guard + deploy. |
| `docs/` | Instance format, Manager contract, and security model. |
