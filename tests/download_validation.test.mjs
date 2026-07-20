import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVaultFixture } from './helpers.mjs';
import { unlockVault, fetchAndDecryptFile, sha256Hex, PrintDriveCryptoError } from '../crypto.js';

const PASSWORD = 'download-validation-password';

function fixtureWithOneFile(plaintext = 'ciphertext download validation payload\n') {
    const fixture = buildVaultFixture(PASSWORD, [
        { name: 'doc.pdf', relativePath: 'doc.pdf', bytes: plaintext }
    ]);
    const entry = fixture.files[0];
    const encrypted = Buffer.from(fixture.blobs.get(entry.path));
    return { fixture, entry, encrypted, plaintext };
}

function respondWith(bytes, contentLength) {
    const headers = {};
    if (contentLength !== undefined) headers['content-length'] = String(contentLength);
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(bytes, { status: 200, headers });
    return () => { globalThis.fetch = original; };
}

test('succeeds when the body equals encryptedSize but Content-Length is larger', async () => {
    const { fixture, entry, encrypted, plaintext } = fixtureWithOneFile();
    const context = await unlockVault(PASSWORD, fixture.envelope);
    const restore = respondWith(encrypted, encrypted.byteLength + 4096); // header lies larger
    try {
        const result = await fetchAndDecryptFile(entry, context);
        assert.equal(Buffer.from(result.bytes).toString('utf8'), plaintext);
    } finally {
        restore();
        context.rawKeyBytes.fill(0);
    }
});

test('fails when the real body is one byte larger than encryptedSize', async () => {
    const { fixture, entry, encrypted } = fixtureWithOneFile();
    const context = await unlockVault(PASSWORD, fixture.envelope);
    const bigger = Buffer.concat([encrypted, Buffer.from([0x00])]);
    const restore = respondWith(bigger, bigger.byteLength);
    try {
        await assert.rejects(
            () => fetchAndDecryptFile(entry, context),
            (error) => error instanceof PrintDriveCryptoError && error.code === 'CIPHERTEXT_SIZE_MISMATCH'
        );
    } finally {
        restore();
        context.rawKeyBytes.fill(0);
    }
});

test('fails when the real body is one byte smaller than encryptedSize', async () => {
    const { fixture, entry, encrypted } = fixtureWithOneFile();
    const context = await unlockVault(PASSWORD, fixture.envelope);
    const smaller = encrypted.subarray(0, encrypted.byteLength - 1);
    const restore = respondWith(smaller, smaller.byteLength);
    try {
        await assert.rejects(
            () => fetchAndDecryptFile(entry, context),
            (error) => error instanceof PrintDriveCryptoError && error.code === 'CIPHERTEXT_SIZE_MISMATCH'
        );
    } finally {
        restore();
        context.rawKeyBytes.fill(0);
    }
});

test('a size failure and a hash failure are distinct error codes', async () => {
    const { fixture, entry, encrypted } = fixtureWithOneFile();
    const context = await unlockVault(PASSWORD, fixture.envelope);
    // Same length, tampered content -> ciphertext SHA-256 mismatch (not a size error).
    const tampered = Buffer.from(encrypted);
    tampered[0] ^= 0xff;
    const restore = respondWith(tampered, tampered.byteLength);
    try {
        await assert.rejects(
            () => fetchAndDecryptFile(entry, context),
            (error) => error instanceof PrintDriveCryptoError && error.code === 'CIPHERTEXT_HASH_MISMATCH'
        );
    } finally {
        restore();
        context.rawKeyBytes.fill(0);
    }
});

test('an authentication failure is distinct from a size failure', async () => {
    const { fixture, entry, encrypted } = fixtureWithOneFile();
    const context = await unlockVault(PASSWORD, fixture.envelope);
    // Tamper the ciphertext AND update the entry hash so the size and SHA-256
    // checks pass, leaving AES-GCM authentication as the failing stage.
    const tampered = Buffer.from(encrypted);
    tampered[tampered.byteLength - 1] ^= 0xff;
    const forgedEntry = { ...entry, ciphertextSha256: await sha256Hex(tampered) };
    const restore = respondWith(tampered, tampered.byteLength);
    try {
        await assert.rejects(
            () => fetchAndDecryptFile(forgedEntry, context),
            (error) => error instanceof PrintDriveCryptoError && error.code === 'FILE_AUTHENTICATION_FAILED'
        );
    } finally {
        restore();
        context.rawKeyBytes.fill(0);
    }
});
