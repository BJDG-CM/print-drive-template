import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyChangedPaths, forceFullReason, ZERO_SHA } from '../scripts/deploy_scope.mjs';

test('fast path when only instance content changed', () => {
    assert.equal(classifyChangedPaths(['files/manifest.enc']), 'fast');
    assert.equal(classifyChangedPaths([`files/${'a'.repeat(32)}.bin`, 'print-drive.instance.json']), 'fast');
    assert.equal(classifyChangedPaths(['print-drive.instance.json']), 'fast');
    assert.equal(classifyChangedPaths(['files/manifest.enc', `files/${'b'.repeat(32)}.bin`]), 'fast');
});

test('full path when any source-affecting file changed', () => {
    assert.equal(classifyChangedPaths(['files/manifest.enc', 'app.js']), 'full');
    assert.equal(classifyChangedPaths(['index.html']), 'full');
    assert.equal(classifyChangedPaths(['crypto.js']), 'full');
    assert.equal(classifyChangedPaths(['.github/workflows/deploy.yml']), 'full');
    assert.equal(classifyChangedPaths(['scripts/build_dist.mjs']), 'full');
    assert.equal(classifyChangedPaths(['docs/SECURITY_MODEL.md']), 'full');
    assert.equal(classifyChangedPaths(['print-drive.instance.json', 'README.md']), 'full');
});

test('empty change set is full (nothing to fast-deploy)', () => {
    assert.equal(classifyChangedPaths([]), 'full');
    assert.equal(classifyChangedPaths(null), 'full');
    assert.equal(classifyChangedPaths(['   ']), 'full');
});

test('paths are normalized before matching', () => {
    assert.equal(classifyChangedPaths(['"files/manifest.enc"']), 'fast');
    assert.equal(classifyChangedPaths(['files\\manifest.enc']), 'fast');
});

test('forceFullReason forces full for non-push, first push, and invalid before SHA', () => {
    assert.ok(forceFullReason({ eventName: 'workflow_dispatch', beforeSha: 'a'.repeat(40) }));
    assert.ok(forceFullReason({ eventName: 'push', beforeSha: ZERO_SHA }));
    assert.ok(forceFullReason({ eventName: 'push', beforeSha: 'not-a-sha' }));
    assert.ok(forceFullReason({ eventName: 'push', beforeSha: '' }));
    assert.equal(forceFullReason({ eventName: 'push', beforeSha: 'a'.repeat(40) }), null);
});

test('fast and full are mutually exclusive strings', () => {
    for (const paths of [['files/manifest.enc'], ['app.js'], []]) {
        const mode = classifyChangedPaths(paths);
        assert.ok(mode === 'fast' || mode === 'full');
    }
});
