import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.tmp', 'files']);

// Owner-specific values that must never ship in a reusable template. The owner
// token is assembled from parts so this scanner does not match itself.
const SELF = path.basename(fileURLToPath(import.meta.url));
const FORBIDDEN_PATTERNS = [
    { label: 'source repository owner', re: new RegExp(['BJDG', 'CM'].join('-')) },
    { label: 'a maintainer email address', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i }
];

async function* walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            yield* walk(path.join(dir, entry.name));
        } else if (entry.isFile()) {
            yield path.join(dir, entry.name);
        }
    }
}

test('no tracked source file carries owner-specific values', async () => {
    const offenders = [];
    for await (const file of walk(PROJECT_ROOT)) {
        // Binary-ish assets are irrelevant to identity leakage.
        if (/\.(png|jpg|jpeg|gif|ico|woff2?)$/i.test(file)) continue;
        if (path.basename(file) === SELF) continue;
        const text = await readFile(file, 'utf8');
        for (const { label, re } of FORBIDDEN_PATTERNS) {
            if (re.test(text)) {
                offenders.push(`${path.relative(PROJECT_ROOT, file)} contains ${label}`);
            }
        }
    }
    assert.deepEqual(offenders, [], `owner-specific values found:\n${offenders.join('\n')}`);
});

test('the shipped instance file is uninitialized and carries no vault id', async () => {
    const instance = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'print-drive.instance.json'), 'utf8'));
    assert.equal(instance.initialized, false);
    assert.equal(instance.formatVersion, 1);
    assert.equal(instance.application, 'print-drive');
    assert.ok(!('vaultId' in instance), 'template must not ship a vault id');
    assert.ok(!('owner' in instance), 'template must not ship an owner');
    assert.ok(!('pagesUrl' in instance), 'template must not ship a Pages URL');
});

test('the empty vault ships no encrypted objects or manifest', async () => {
    const entries = await readdir(path.join(PROJECT_ROOT, 'files'));
    assert.deepEqual(entries.sort(), ['.gitkeep']);
});
