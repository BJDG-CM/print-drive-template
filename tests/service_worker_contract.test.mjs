import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_ASSETS } from '../scripts/build_dist.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function shellAssets() {
    const source = await readFile(path.join(PROJECT_ROOT, 'sw.js'), 'utf8');
    const match = source.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
    assert.ok(match, 'SHELL_ASSETS array not found in sw.js');
    return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('every precached shell asset exists and none is ciphertext or volatile metadata', async () => {
    const assets = await shellAssets();
    for (const asset of assets) {
        assert.ok(!asset.includes('/files/'), `service worker must not precache ciphertext: ${asset}`);
        assert.ok(!asset.endsWith('build-meta.json'), `build-meta.json must not be precached: ${asset}`);
        assert.ok(!asset.endsWith('print-drive.instance.json'), `instance metadata must not be precached: ${asset}`);
        if (asset === './') continue;
        await access(path.join(PROJECT_ROOT, asset.replace(/^\.\//, '')));
    }
});

test('all browser JS/CSS/HTML modules are precached by the service worker', async () => {
    const assets = new Set(await shellAssets());
    // robots.txt and sw.js itself are not part of the offline app shell.
    const shellRelevant = BROWSER_ASSETS.filter((name) => name !== 'robots.txt' && name !== 'sw.js');
    for (const name of shellRelevant) {
        assert.ok(assets.has(`./${name}`), `sw.js SHELL_ASSETS is missing ./${name}`);
    }
});

test('the fetch handler bypasses the cache for ciphertext, build, and instance metadata', async () => {
    const source = await readFile(path.join(PROJECT_ROOT, 'sw.js'), 'utf8');
    assert.match(source, /includes\('\/files\/'\)/);
    assert.match(source, /build-meta\.json/);
    assert.match(source, /print-drive\.instance\.json/);
    assert.match(source, /cache:\s*'no-store'/);
});
