import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVaultFixture, installBlobFetch } from './helpers.mjs';
import {
    unlockVault,
    decryptManifest,
    fetchAndDecryptFile,
    PrintDriveCryptoError
} from '../crypto.js';

const PASSWORD = 'correct-horse-battery-staple';

test('browser opens an initialized empty vault and sees zero files', async () => {
    const fixture = buildVaultFixture(PASSWORD, []);
    const context = await unlockVault(PASSWORD, fixture.envelope);
    const manifest = await decryptManifest(fixture.envelope, context);
    assert.equal(manifest.files.length, 0);
    context.rawKeyBytes.fill(0);
});

test('browser browses a vault with root and nested files', async () => {
    const fixture = buildVaultFixture(PASSWORD, [
        { name: '보고서.pdf', relativePath: '보고서.pdf', bytes: 'root report\n' },
        { name: '설계.md', relativePath: '문서/설계.md', bytes: '# design\n' },
        { name: 'photo.png', relativePath: '문서/이미지/photo.png', bytes: 'PNGDATA' }
    ]);
    const context = await unlockVault(PASSWORD, fixture.envelope);
    const manifest = await decryptManifest(fixture.envelope, context);

    const paths = manifest.files.map((file) => file.relativePath).sort();
    assert.deepEqual(paths, ['문서/설계.md', '문서/이미지/photo.png', '보고서.pdf']);

    // Fetch + decrypt one nested file end to end.
    const restore = installBlobFetch(fixture.blobs);
    try {
        const target = manifest.files.find((file) => file.relativePath === '문서/이미지/photo.png');
        const decrypted = await fetchAndDecryptFile(target, context);
        assert.equal(Buffer.from(decrypted.bytes).toString('utf8'), 'PNGDATA');
    } finally {
        restore();
        context.rawKeyBytes.fill(0);
    }
});

test('filenames and logical paths are encrypted, blob paths are opaque', () => {
    const fixture = buildVaultFixture(PASSWORD, [
        { name: '기밀-계약서.pdf', relativePath: '비밀/기밀-계약서.pdf', bytes: 'secret' }
    ]);
    // The public envelope (manifest.enc bytes) must not leak the plaintext name
    // or logical path anywhere in its serialized form.
    const serialized = JSON.stringify(fixture.envelope);
    assert.ok(!serialized.includes('기밀-계약서'), 'plaintext filename leaked into envelope');
    assert.ok(!serialized.includes('비밀'), 'plaintext logical path leaked into envelope');

    // Every public object path is an opaque 32-hex .bin path.
    for (const object of fixture.envelope.objectIndex.objects) {
        assert.match(object.path, /^files\/[0-9a-f]{32}\.bin$/);
    }
});

test('a wrong password cannot unlock the vault', async () => {
    const fixture = buildVaultFixture(PASSWORD, [
        { name: 'a.txt', relativePath: 'a.txt', bytes: 'hello' }
    ]);
    await assert.rejects(
        () => unlockVault('the-wrong-password', fixture.envelope),
        (error) => error instanceof PrintDriveCryptoError && error.code === 'INVALID_PASSWORD'
    );
});

test('the correct password unlocks and authenticates the manifest', async () => {
    const fixture = buildVaultFixture(PASSWORD, [
        { name: 'a.txt', relativePath: 'a.txt', bytes: 'hello' }
    ]);
    const context = await unlockVault(PASSWORD, fixture.envelope);
    const manifest = await decryptManifest(fixture.envelope, context);
    assert.equal(manifest.files[0].name, 'a.txt');
    context.rawKeyBytes.fill(0);
});
