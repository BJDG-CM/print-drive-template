import assert from 'node:assert/strict';
import test from 'node:test';
import {
    THEME_STORAGE_KEY,
    normalizeTheme,
    resolveTheme,
    themeColorFor,
    readStoredTheme,
    createThemeController
} from '../theme.js';

test('normalizeTheme coerces invalid values to system', () => {
    assert.equal(normalizeTheme('light'), 'light');
    assert.equal(normalizeTheme('dark'), 'dark');
    assert.equal(normalizeTheme('system'), 'system');
    assert.equal(normalizeTheme('neon'), 'system');
    assert.equal(normalizeTheme(null), 'system');
    assert.equal(normalizeTheme(undefined), 'system');
});

test('resolveTheme follows the OS only in system mode', () => {
    assert.equal(resolveTheme('system', true), 'dark');
    assert.equal(resolveTheme('system', false), 'light');
    assert.equal(resolveTheme('light', true), 'light'); // explicit ignores OS
    assert.equal(resolveTheme('dark', false), 'dark');
});

test('themeColorFor maps resolved theme to a meta color', () => {
    assert.equal(themeColorFor('dark'), '#0b1220');
    assert.equal(themeColorFor('light'), '#1d4ed8');
});

// Minimal DOM/storage/matchMedia doubles for the controller.
function fakeEnvironment(initialStored, prefersDark) {
    const store = new Map(initialStored ? [[THEME_STORAGE_KEY, initialStored]] : []);
    const storage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, v)
    };
    const root = { dataset: {} };
    const meta = { attrs: { content: '' }, setAttribute(n, v) { this.attrs[n] = v; }, getAttribute(n) { return this.attrs[n]; } };
    const doc = {
        documentElement: root,
        querySelector: (sel) => (sel.includes('theme-color') ? meta : null),
        querySelectorAll: () => []
    };
    let listener = null;
    const query = {
        matches: prefersDark,
        addEventListener: (_e, cb) => { listener = cb; },
        removeEventListener: () => { listener = null; }
    };
    const matchMedia = () => query;
    return {
        storage, doc, matchMedia, root, meta, store,
        fireOsChange(nextPrefersDark) { query.matches = nextPrefersDark; listener?.(); }
    };
}

test('controller applies the stored theme and persists changes', () => {
    const env = fakeEnvironment('dark', false);
    const controller = createThemeController({ document: env.doc, storage: env.storage, matchMedia: env.matchMedia });
    assert.equal(controller.getMode(), 'dark');
    assert.equal(env.root.dataset.theme, 'dark');
    assert.equal(env.meta.getAttribute('content'), '#0b1220');

    controller.setMode('light');
    assert.equal(env.store.get(THEME_STORAGE_KEY), 'light');
    assert.equal(env.root.dataset.theme, 'light');
    assert.equal(env.meta.getAttribute('content'), '#1d4ed8');
});

test('an invalid stored value resolves to system', () => {
    const env = fakeEnvironment('rainbow', true);
    assert.equal(readStoredTheme(env.storage), 'system');
    const controller = createThemeController({ document: env.doc, storage: env.storage, matchMedia: env.matchMedia });
    assert.equal(controller.getMode(), 'system');
    assert.equal(env.root.dataset.theme, 'system');
    assert.equal(env.meta.getAttribute('content'), '#0b1220'); // system + OS dark
});

test('system mode reacts to OS changes; explicit mode does not', () => {
    const env = fakeEnvironment('system', false);
    const controller = createThemeController({ document: env.doc, storage: env.storage, matchMedia: env.matchMedia });
    assert.equal(env.meta.getAttribute('content'), '#1d4ed8');
    env.fireOsChange(true);
    assert.equal(env.meta.getAttribute('content'), '#0b1220'); // followed OS

    controller.setMode('light');
    env.fireOsChange(false);
    env.fireOsChange(true);
    assert.equal(env.root.dataset.theme, 'light'); // stayed put
    assert.equal(env.meta.getAttribute('content'), '#1d4ed8');
});
