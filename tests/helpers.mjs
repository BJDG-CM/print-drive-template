// Test helpers: build Node-side v2 vault fixtures (envelope + encrypted blobs)
// the same way Print Drive Manager would, so the browser crypto can be exercised
// against them. Uses padding blockSize 0 to keep sizes exact in tests.

import { webcrypto, randomBytes } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}
if (!globalThis.location) {
    globalThis.location = new URL('https://example.test/print-drive/');
}

import {
    createCryptoDescriptor,
    createEncryptedManifest,
    createFileAad,
    createObjectIndex,
    createPasswordKeySlot,
    deriveVaultSubkeys,
    encryptAesGcm,
    randomHex,
    sha256Hex,
    wrapDek,
    compareUnicode
} from '../vault_format.mjs';

const APP_ID = 'print-drive';

// files: [{ name, relativePath, bytes }]
export function buildVaultFixture(password, files = []) {
    const vaultId = randomHex(16);
    const vaultKey = randomBytes(32);
    const manifestId = randomHex(16);
    const { dekWrapKey } = deriveVaultSubkeys(vaultKey, vaultId);
    const now = '2026-07-19T00:00:00.000Z';

    const manifestFiles = [];
    const blobs = new Map(); // path -> encrypted bytes
    for (const input of files) {
        const bytes = Buffer.from(input.bytes);
        const logicalId = randomHex(16);
        const blobId = randomHex(16);
        const dek = randomBytes(32);
        const dataIv = randomBytes(12);
        const wrapIv = randomBytes(12);
        const sha256 = sha256Hex(bytes);
        const descriptor = { logicalId, blobId, size: bytes.byteLength, paddedSize: bytes.byteLength, sha256 };
        const encrypted = encryptAesGcm(dek, dataIv, bytes, createFileAad(vaultId, descriptor));
        const path = `files/${blobId}.bin`;
        blobs.set(path, encrypted);
        manifestFiles.push({
            logicalId,
            blobId,
            path,
            name: input.name,
            relativePath: input.relativePath,
            size: bytes.byteLength,
            paddedSize: bytes.byteLength,
            encryptedSize: encrypted.byteLength,
            sha256,
            ciphertextSha256: sha256Hex(encrypted),
            modifiedAt: now,
            dataIv: dataIv.toString('base64url'),
            wrappedDek: wrapDek(dek, dekWrapKey, vaultId, logicalId, blobId, { iv: wrapIv })
        });
    }
    manifestFiles.sort((a, b) => compareUnicode(a.relativePath, b.relativePath));

    const manifest = { createdAt: now, updatedAt: now, files: manifestFiles };
    const encryptedManifest = createEncryptedManifest(manifest, vaultKey, vaultId, { id: manifestId, revision: 1 });
    const envelope = {
        version: 2,
        app: APP_ID,
        vaultId,
        keySlots: [createPasswordKeySlot(password, vaultKey, vaultId, { iterations: 200_000 })],
        crypto: createCryptoDescriptor(0),
        objectIndex: createObjectIndex(manifestFiles),
        manifest: encryptedManifest.descriptor
    };
    vaultKey.fill(0);
    return { envelope, manifest: encryptedManifest.payload, files: manifestFiles, blobs };
}

// Installs a global fetch that serves a fixture's encrypted blobs by path.
export function installBlobFetch(blobs) {
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
        const url = typeof input === 'string' ? input : input.url || String(input);
        const pathname = new URL(url, globalThis.location.href).pathname;
        for (const [relative, bytes] of blobs) {
            if (pathname.endsWith(`/${relative}`) || pathname.endsWith(relative)) {
                return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength) } });
            }
        }
        return new Response('not found', { status: 404 });
    };
    return () => { globalThis.fetch = original; };
}
