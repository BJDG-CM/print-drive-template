import assert from 'node:assert/strict';
import test from 'node:test';
import { clearAppManagedBrowserData, PRESERVED_STORAGE_KEYS } from '../public_device.js';

function fakeStorage(initial) {
    const map = new Map(Object.entries(initial));
    return {
        get length() { return map.size; },
        key(index) { return [...map.keys()][index] ?? null; },
        getItem(k) { return map.has(k) ? map.get(k) : null; },
        removeItem(k) { map.delete(k); },
        _map: map
    };
}

test('theme preference is the only preserved storage key', () => {
    assert.ok(PRESERVED_STORAGE_KEYS.has('print-drive-theme'));
    assert.equal(PRESERVED_STORAGE_KEYS.size, 1);
});

test('public-device cleanup removes session data but keeps the theme', async () => {
    const local = fakeStorage({
        'print-drive-theme': 'dark',
        'print-drive-session-v2': 'secret-session',
        'print-drive-vault-state': 'sensitive',
        'unrelated-key': 'kept-because-not-ours'
    });
    const session = fakeStorage({ 'print-drive-preview': 'blob-url' });

    const report = await clearAppManagedBrowserData({ localStorage: local, sessionStorage: session });

    assert.equal(local.getItem('print-drive-theme'), 'dark', 'theme must survive cleanup');
    assert.equal(local.getItem('print-drive-session-v2'), null, 'session data must be cleared');
    assert.equal(local.getItem('print-drive-vault-state'), null, 'vault state must be cleared');
    assert.equal(local.getItem('unrelated-key'), 'kept-because-not-ours', 'non-app keys are untouched');
    assert.equal(session.getItem('print-drive-preview'), null, 'session storage app keys are cleared');
    assert.ok(Array.isArray(report.cleared));
});
