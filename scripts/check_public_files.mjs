#!/usr/bin/env node
// Plaintext guard for a Print Drive instance.
//
// Proves — without the vault password — that the public payload contains only
// opaque encrypted blobs and non-secret metadata, and that every published blob
// is referenced by the authenticated public objectIndex with a matching hash.
//
// Exits non-zero (failing the Pages build) if any plaintext user file, stray
// object, secret-bearing instance key, or manifest/blob mismatch is found.

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
    parseEnvelopeText,
    validateEnvelopeV2,
    sha256Hex
} from '../vault_format.mjs';
import { INSTANCE_URL, classifyInstance } from '../instance.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLOB_RE = /^[0-9a-f]{32}\.bin$/;
const ALLOWED_NON_BLOB = new Set(['.gitkeep', 'manifest.enc']);

export async function checkPublicFiles(options = {}) {
    const root = path.resolve(options.projectRoot || PROJECT_ROOT);
    const filesDir = path.join(root, 'files');
    const instancePath = path.join(root, INSTANCE_URL);
    const errors = [];

    // 1. Public instance metadata: valid shape, no secrets.
    let instanceState;
    try {
        const instance = JSON.parse(await readFile(instancePath, 'utf8'));
        instanceState = classifyInstance(instance);
    } catch (error) {
        throw new Error(`${INSTANCE_URL} is missing or invalid: ${error.message}`);
    }

    // 2. Enumerate the files/ directory; only opaque blobs and metadata allowed.
    let entries = [];
    try {
        entries = await readdir(filesDir, { withFileTypes: true });
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const blobNames = new Set();
    let hasManifest = false;
    for (const entry of entries) {
        if (!entry.isFile()) {
            errors.push(`files/${entry.name} is not a regular file; only encrypted blobs are allowed.`);
            continue;
        }
        if (entry.name === 'manifest.enc') {
            hasManifest = true;
        } else if (BLOB_RE.test(entry.name)) {
            blobNames.add(entry.name);
        } else if (!ALLOWED_NON_BLOB.has(entry.name)) {
            errors.push(`files/${entry.name} is not an encrypted blob (expected <32-hex>.bin) — possible plaintext leak.`);
        }
    }

    // 3. Lifecycle consistency between instance flag and on-disk manifest.
    const initialized = instanceState.status === 'initialized';
    if (initialized && !hasManifest) {
        errors.push('instance is marked initialized but files/manifest.enc is missing.');
    }
    if (!initialized && hasManifest) {
        errors.push('files/manifest.enc exists but instance is not marked initialized.');
    }
    if (!initialized && blobNames.size > 0) {
        errors.push('encrypted blobs exist but the instance is not initialized.');
    }

    // 4. When initialized, verify every blob against the authenticated index.
    if (hasManifest && errors.length === 0) {
        const envelope = parseEnvelopeText(await readFile(path.join(filesDir, 'manifest.enc'), 'utf8'));
        validateEnvelopeV2(envelope);
        const referenced = new Set();
        for (const object of envelope.objectIndex.objects) {
            const name = path.basename(object.path);
            if (object.path !== `files/${name}` || !BLOB_RE.test(name)) {
                errors.push(`objectIndex path ${object.path} is not an opaque files/<blob>.bin path.`);
                continue;
            }
            referenced.add(name);
            if (!blobNames.has(name)) {
                errors.push(`objectIndex references files/${name} but the blob is missing.`);
                continue;
            }
            const bytes = await readFile(path.join(filesDir, name));
            const info = await stat(path.join(filesDir, name));
            if (info.size !== object.encryptedSize) {
                errors.push(`files/${name} size ${info.size} != objectIndex encryptedSize ${object.encryptedSize}.`);
            }
            if (sha256Hex(bytes) !== object.ciphertextSha256) {
                errors.push(`files/${name} ciphertext SHA-256 does not match objectIndex.`);
            }
        }
        for (const name of blobNames) {
            if (!referenced.has(name)) {
                errors.push(`files/${name} is not referenced by the authenticated objectIndex.`);
            }
        }
    }

    if (errors.length > 0) {
        throw new Error(`Public files check failed:\n${errors.map((line) => `- ${line}`).join('\n')}`);
    }
    return {
        initialized,
        blobCount: blobNames.size,
        vaultId: initialized ? instanceState.instance.vaultId ?? null : null
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    checkPublicFiles()
        .then((result) => {
            console.log(result.initialized
                ? `Public files check passed: initialized vault with ${result.blobCount} verified blob(s).`
                : 'Public files check passed: uninitialized instance (no plaintext, no blobs).');
        })
        .catch((error) => {
            console.error(error.message);
            process.exit(1);
        });
}
