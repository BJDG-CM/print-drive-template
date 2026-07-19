#!/usr/bin/env node
// Builds the public GitHub Pages artifact for a Print Drive instance.
//
// - copies only the allowlisted public web assets and the encrypted payload
// - runs the plaintext guard and fails if any plaintext file is present
// - stamps a build identity into index.html / sw.js and writes build-meta.json
//   so the browser (and Print Drive Manager) can confirm the deployed build
//
// The build never sees the vault password or any GitHub token.

import { readFile, writeFile, mkdir, rm, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseEnvelopeText, validateEnvelopeV2 } from '../vault_format.mjs';
import { checkPublicFiles } from './check_public_files.mjs';
import { INSTANCE_URL } from '../instance.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_ID_PLACEHOLDER = '__PRINT_DRIVE_BUILD_ID__';

// The complete public web-app shell. vault_format.mjs and everything under
// scripts/ and tests/ are intentionally excluded — they are Node-only tooling
// and must never be deployed.
export const BROWSER_ASSETS = Object.freeze([
    'index.html',
    'styles.css',
    'bootstrap.js',
    'build_identity.js',
    'instance.js',
    'app.js',
    'crypto.js',
    'file_errors.js',
    'folder_browser.js',
    'logical_path.js',
    'capability.js',
    'public_device.js',
    'file_types.js',
    'ui.js',
    'zip.js',
    'qr.js',
    'manifest.json',
    'icon.svg',
    'robots.txt',
    'sw.js'
]);

const BLOB_RE = /^[0-9a-f]{32}\.bin$/;

async function computeBuildIdentity(root) {
    const hash = createHash('sha256');
    for (const relative of [...BROWSER_ASSETS].sort()) {
        hash.update(relative);
        hash.update('\0');
        hash.update(await readFile(path.join(root, relative)));
        hash.update('\0');
    }
    const instanceBytes = await readFile(path.join(root, INSTANCE_URL));
    hash.update(`${INSTANCE_URL}\0`);
    hash.update(instanceBytes);

    const identity = {
        version: 1,
        buildId: '',
        initialized: false
    };
    const manifestPath = path.join(root, 'files', 'manifest.enc');
    try {
        const manifestBytes = await readFile(manifestPath);
        hash.update('files/manifest.enc\0');
        hash.update(manifestBytes);
        const envelope = parseEnvelopeText(manifestBytes.toString('utf8'));
        validateEnvelopeV2(envelope);
        identity.initialized = true;
        identity.vault = {
            version: envelope.version,
            schema: envelope.manifest.schema,
            revision: envelope.manifest.revision,
            manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
            objects: envelope.objectIndex.objects.length
        };
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    identity.buildId = hash.digest('hex');
    return identity;
}

export async function buildDist(options = {}) {
    const root = path.resolve(options.projectRoot || PROJECT_ROOT);
    const distDir = path.join(root, 'dist');

    // Fail early on any plaintext or manifest/blob mismatch.
    await checkPublicFiles({ projectRoot: root });

    const identity = await computeBuildIdentity(root);

    await rm(distDir, { recursive: true, force: true });
    await mkdir(path.join(distDir, 'files'), { recursive: true });

    for (const relative of BROWSER_ASSETS) {
        await copyFile(path.join(root, relative), path.join(distDir, relative));
    }
    await copyFile(path.join(root, INSTANCE_URL), path.join(distDir, INSTANCE_URL));

    // Stamp the build id into the shell and the service worker.
    for (const relative of ['index.html', 'sw.js']) {
        const target = path.join(distDir, relative);
        const source = await readFile(target, 'utf8');
        if (!source.includes(BUILD_ID_PLACEHOLDER)) {
            throw new Error(`${relative} is missing the build identity placeholder.`);
        }
        await writeFile(target, source.replaceAll(BUILD_ID_PLACEHOLDER, identity.buildId), 'utf8');
    }
    await writeFile(path.join(distDir, 'build-meta.json'), `${JSON.stringify(identity, null, 2)}\n`, 'utf8');

    // Copy only allowlisted encrypted payload files.
    let filesEntries = [];
    try {
        filesEntries = await readdir(path.join(root, 'files'), { withFileTypes: true });
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    for (const entry of filesEntries) {
        if (!entry.isFile()) continue;
        if (entry.name === 'manifest.enc' || BLOB_RE.test(entry.name)) {
            await copyFile(path.join(root, 'files', entry.name), path.join(distDir, 'files', entry.name));
        }
    }

    // Re-run the guard against the staged dist so the deployed tree is proven.
    await checkPublicFiles({ projectRoot: distDir });

    return { distDir, identity };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    buildDist()
        .then(({ distDir, identity }) => {
            console.log(`Built Pages artifact in ${distDir} (build ${identity.buildId.slice(0, 12)}…, initialized=${identity.initialized}).`);
        })
        .catch((error) => {
            console.error(error.message);
            process.exit(1);
        });
}
