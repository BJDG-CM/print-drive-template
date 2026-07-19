import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, cp, rm, writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPublicFiles } from '../scripts/check_public_files.mjs';
import { buildDist } from '../scripts/build_dist.mjs';
import { initVault } from '../scripts/init_vault.mjs';
import { isAllowedManagerPath, MANAGER_WRITE_PATHS } from '../scripts/manager_paths.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD = 'template-verification-password';

async function stageProject() {
    const dir = await mkdtemp(path.join(tmpdir(), 'pd-template-'));
    await cp(PROJECT_ROOT, dir, {
        recursive: true,
        filter: (src) => !/[\\/](node_modules|dist|\.git|\.tmp)([\\/]|$)/.test(src)
    });
    return dir;
}

test('uninitialized template passes the plaintext guard', async () => {
    const dir = await stageProject();
    try {
        const result = await checkPublicFiles({ projectRoot: dir });
        assert.equal(result.initialized, false);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('guard rejects a plaintext file dropped into files/', async () => {
    const dir = await stageProject();
    try {
        await writeFile(path.join(dir, 'files', 'secret-resume.pdf'), 'PLAINTEXT');
        await assert.rejects(() => checkPublicFiles({ projectRoot: dir }), /not an encrypted blob/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('guard rejects an initialized flag with no manifest', async () => {
    const dir = await stageProject();
    try {
        await writeFile(path.join(dir, 'print-drive.instance.json'),
            JSON.stringify({ formatVersion: 1, application: 'print-drive', initialized: true }));
        await assert.rejects(() => checkPublicFiles({ projectRoot: dir }), /marked initialized but/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('init then build produces a clean artifact with only opaque blobs', async () => {
    const dir = await stageProject();
    try {
        await initVault({ projectRoot: dir, password: PASSWORD });
        const { identity } = await buildDist({ projectRoot: dir });
        assert.equal(identity.initialized, true);

        const distFiles = await readdir(path.join(dir, 'dist', 'files'));
        for (const name of distFiles) {
            assert.ok(name === 'manifest.enc' || /^[0-9a-f]{32}\.bin$/.test(name),
                `unexpected file in dist/files: ${name}`);
        }
        // Node-only tooling must never be deployed.
        const distRoot = await readdir(path.join(dir, 'dist'));
        assert.ok(!distRoot.includes('vault_format.mjs'));
        assert.ok(!distRoot.includes('scripts'));
        assert.ok(!distRoot.includes('tests'));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('build stamps a 64-hex build identity into shell, sw, and build-meta', async () => {
    const dir = await stageProject();
    try {
        const { identity } = await buildDist({ projectRoot: dir });
        assert.match(identity.buildId, /^[0-9a-f]{64}$/);
        const meta = JSON.parse(await readFile(path.join(dir, 'dist', 'build-meta.json'), 'utf8'));
        assert.equal(meta.buildId, identity.buildId);
        const index = await readFile(path.join(dir, 'dist', 'index.html'), 'utf8');
        const sw = await readFile(path.join(dir, 'dist', 'sw.js'), 'utf8');
        assert.ok(index.includes(identity.buildId));
        assert.ok(sw.includes(identity.buildId));
        assert.ok(!index.includes('__PRINT_DRIVE_BUILD_ID__'));
        assert.ok(!sw.includes('__PRINT_DRIVE_BUILD_ID__'));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('build identity changes when the vault content changes', async () => {
    const uninit = await stageProject();
    const init = await stageProject();
    try {
        const before = (await buildDist({ projectRoot: uninit })).identity.buildId;
        await initVault({ projectRoot: init, password: PASSWORD });
        const after = (await buildDist({ projectRoot: init })).identity.buildId;
        assert.notEqual(before, after);
    } finally {
        await rm(uninit, { recursive: true, force: true });
        await rm(init, { recursive: true, force: true });
    }
});

test('Manager write-path allowlist permits only the vault and instance paths', () => {
    assert.ok(isAllowedManagerPath('print-drive.instance.json'));
    assert.ok(isAllowedManagerPath('files/manifest.enc'));
    assert.ok(isAllowedManagerPath(`files/${'a'.repeat(32)}.bin`));
    assert.ok(isAllowedManagerPath('./files/manifest.enc'));

    assert.ok(!isAllowedManagerPath('app.js'));
    assert.ok(!isAllowedManagerPath('crypto.js'));
    assert.ok(!isAllowedManagerPath('index.html'));
    assert.ok(!isAllowedManagerPath('.github/workflows/deploy.yml'));
    assert.ok(!isAllowedManagerPath('files/notes.txt'));
    assert.ok(!isAllowedManagerPath('files/manifest.enc.bak'));
    assert.equal(MANAGER_WRITE_PATHS.length, 3);
});
