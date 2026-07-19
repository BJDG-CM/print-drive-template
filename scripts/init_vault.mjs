#!/usr/bin/env node
// Safe initialization mechanism for a Print Drive instance.
//
// Creates the FIRST encrypted manifest for an empty vault, entirely locally,
// and marks print-drive.instance.json as initialized with public metadata only.
// The password never leaves this process and is never written to disk.
//
// Print Drive Manager performs this same operation; this script is the
// documented reference/fallback so a template can be initialized without the
// Manager. Run it on a trusted machine, then commit files/manifest.enc and
// print-drive.instance.json.
//
// Usage:
//   PRINT_DRIVE_PASSWORD='...' node scripts/init_vault.mjs [--force]
//   node scripts/init_vault.mjs            (prompts for the password)
//
// Optional public metadata (non-secret) may be supplied and is stored verbatim:
//   --owner <login> --repo <name> --branch <name> --pages-url <url>

import { readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
    APP_ID,
    FORMAT_VERSION,
    createCryptoDescriptor,
    createEncryptedManifest,
    createObjectIndex,
    createPasswordKeySlot,
    decryptManifestV2,
    randomHex,
    serializeEnvelope,
    validateEnvelopeV2
} from '../vault_format.mjs';
import { INSTANCE_URL, INSTANCE_FORMAT_VERSION, classifyInstance } from '../instance.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_PASSWORD_LENGTH = 8;

function parseArgs(argv) {
    const options = { force: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--force') {
            options.force = true;
        } else if (arg === '--owner') {
            options.owner = argv[++i];
        } else if (arg === '--repo') {
            options.repo = argv[++i];
        } else if (arg === '--branch') {
            options.branch = argv[++i];
        } else if (arg === '--pages-url') {
            options.pagesUrl = argv[++i];
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return options;
}

async function fileExists(target) {
    try {
        await access(target);
        return true;
    } catch {
        return false;
    }
}

async function promptPassword() {
    if (process.env.PRINT_DRIVE_PASSWORD) {
        return process.env.PRINT_DRIVE_PASSWORD;
    }
    if (!process.stdin.isTTY) {
        throw new Error('Set PRINT_DRIVE_PASSWORD when running non-interactively.');
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const question = (query) => new Promise((resolve) => {
        // Mute echo so the password is not shown on screen.
        const onData = () => rl.output.write('[2K[200D비밀번호: ');
        rl.input.on('data', onData);
        rl.question('비밀번호: ', (answer) => {
            rl.input.off('data', onData);
            resolve(answer);
        });
    });
    const first = await question();
    const second = await question();
    rl.output.write('\n');
    rl.close();
    if (first !== second) {
        throw new Error('Passwords did not match.');
    }
    return first;
}

function buildEmptyEnvelope(password) {
    const vaultId = randomHex(16);
    const vaultKey = randomBytes(32);
    const manifestId = randomHex(16);
    const now = new Date().toISOString();
    const manifest = {
        createdAt: now,
        updatedAt: now,
        files: []
    };
    const encryptedManifest = createEncryptedManifest(manifest, vaultKey, vaultId, {
        id: manifestId,
        revision: 1
    });
    const envelope = {
        version: FORMAT_VERSION,
        app: APP_ID,
        vaultId,
        keySlots: [createPasswordKeySlot(password, vaultKey, vaultId)],
        crypto: createCryptoDescriptor(),
        objectIndex: createObjectIndex([]),
        manifest: encryptedManifest.descriptor
    };
    validateEnvelopeV2(envelope);
    // Prove the freshly written vault opens with the chosen password before we
    // persist anything, and that it decrypts to an empty file list.
    const decrypted = decryptManifestV2(envelope, vaultKey);
    if (decrypted.files.length !== 0) {
        throw new Error('Sanity check failed: new vault is not empty.');
    }
    vaultKey.fill(0);
    return { envelope, vaultId };
}

async function loadInstance(instancePath) {
    const text = await readFile(instancePath, 'utf8');
    const parsed = JSON.parse(text);
    classifyInstance(parsed); // validates shape + rejects any secret key
    return parsed;
}

export async function initVault(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || PROJECT_ROOT);
    const manifestPath = path.join(projectRoot, 'files', 'manifest.enc');
    const instancePath = path.join(projectRoot, INSTANCE_URL);

    if (!options.force && await fileExists(manifestPath)) {
        throw new Error(`${manifestPath} already exists. Pass --force only if you intend to replace the vault.`);
    }
    const instance = await loadInstance(instancePath);
    if (instance.initialized === true && !options.force) {
        throw new Error('print-drive.instance.json already marks this instance initialized. Use --force to reinitialize.');
    }

    const password = options.password ?? await promptPassword();
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    const { envelope, vaultId } = buildEmptyEnvelope(password);
    await writeFile(manifestPath, serializeEnvelope(envelope), 'utf8');

    const nextInstance = {
        formatVersion: INSTANCE_FORMAT_VERSION,
        application: APP_ID,
        initialized: true,
        vaultId,
        vaultFormatVersion: FORMAT_VERSION,
        initializedAt: new Date().toISOString()
    };
    if (options.owner) nextInstance.owner = options.owner;
    if (options.repo) nextInstance.repo = options.repo;
    if (options.branch) nextInstance.branch = options.branch;
    if (options.pagesUrl) nextInstance.pagesUrl = options.pagesUrl;
    classifyInstance(nextInstance);
    await writeFile(instancePath, `${JSON.stringify(nextInstance, null, 2)}\n`, 'utf8');

    return { vaultId };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    initVault(parseArgs(process.argv.slice(2)))
        .then(({ vaultId }) => {
            console.log(`Initialized empty vault ${vaultId}.`);
            console.log('Commit files/manifest.enc and print-drive.instance.json to publish it.');
        })
        .catch((error) => {
            console.error(error.message);
            process.exit(1);
        });
}
