import assert from 'node:assert/strict';
import test from 'node:test';
import {
    classifyInstance,
    fetchInstanceState,
    assertNoInstanceSecrets,
    InstanceMetadataError
} from '../instance.js';

test('uninitialized instance classifies as the not-yet-initialized state', () => {
    const result = classifyInstance({ formatVersion: 1, application: 'print-drive', initialized: false });
    assert.equal(result.status, 'uninitialized');
});

test('initialized instance classifies as initialized', () => {
    const result = classifyInstance({
        formatVersion: 1,
        application: 'print-drive',
        initialized: true,
        vaultId: 'a'.repeat(32)
    });
    assert.equal(result.status, 'initialized');
});

test('a missing initialized flag is treated as uninitialized', () => {
    const result = classifyInstance({ formatVersion: 1, application: 'print-drive' });
    assert.equal(result.status, 'uninitialized');
});

test('secret-bearing instance keys are rejected at any depth', () => {
    assert.throws(() => classifyInstance({
        formatVersion: 1, application: 'print-drive', initialized: true, password: 'x'
    }), InstanceMetadataError);
    assert.throws(() => assertNoInstanceSecrets({ nested: { githubToken: 'x' } }), InstanceMetadataError);
    assert.throws(() => assertNoInstanceSecrets({ vaultKey: 'x' }), InstanceMetadataError);
});

test('wrong application or format version is a deployment error, not a state', () => {
    assert.throws(() => classifyInstance({ formatVersion: 1, application: 'other', initialized: true }), InstanceMetadataError);
    assert.throws(() => classifyInstance({ formatVersion: 2, application: 'print-drive', initialized: true }), InstanceMetadataError);
});

test('fetchInstanceState maps a 404 to uninitialized', async () => {
    const state = await fetchInstanceState({
        locationHref: 'https://example.test/pd/',
        fetch: async () => new Response('nope', { status: 404 })
    });
    assert.equal(state.status, 'uninitialized');
});

test('fetchInstanceState reads an initialized instance file', async () => {
    const body = JSON.stringify({ formatVersion: 1, application: 'print-drive', initialized: true, vaultId: 'b'.repeat(32) });
    const state = await fetchInstanceState({
        locationHref: 'https://example.test/pd/',
        fetch: async () => new Response(body, { status: 200 })
    });
    assert.equal(state.status, 'initialized');
});

test('a network failure falls through to unknown, not uninitialized', async () => {
    const state = await fetchInstanceState({
        locationHref: 'https://example.test/pd/',
        fetch: async () => { throw new TypeError('network down'); }
    });
    assert.equal(state.status, 'unknown');
});
