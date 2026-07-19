// Public instance-metadata contract shared by the browser shell, the build
// pipeline, and Print Drive Manager. This file never touches the vault
// password or any secret; it only classifies non-secret public metadata.

export const INSTANCE_URL = 'print-drive.instance.json';
export const INSTANCE_FORMAT_VERSION = 1;
export const APPLICATION_ID = 'print-drive';

// Keys that must never appear in the public instance file. The build guard and
// Manager reuse this list so a secret can never leak into a public artifact.
export const FORBIDDEN_INSTANCE_KEYS = Object.freeze([
    'password',
    'passphrase',
    'vaultKey',
    'key',
    'token',
    'githubToken',
    'pat',
    'secret',
    'clientSecret',
    'privateKey'
]);

const FORBIDDEN_KEY_RE = /(pass(word|phrase)?|secret|token|credential|private.?key|vault.?key|github.?(token|pat)|client.?secret)/i;

export class InstanceMetadataError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InstanceMetadataError';
    }
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Rejects any instance object that carries a forbidden secret-bearing key,
// at any nesting depth. Throws InstanceMetadataError on the first hit.
export function assertNoInstanceSecrets(value, path = 'print-drive.instance.json') {
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertNoInstanceSecrets(item, `${path}[${index}]`));
        return;
    }
    if (!isPlainObject(value)) {
        return;
    }
    for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEY_RE.test(key)) {
            throw new InstanceMetadataError(`${path}.${key} is forbidden; the instance file must never carry secrets.`);
        }
        assertNoInstanceSecrets(value[key], `${path}.${key}`);
    }
}

// Classifies a parsed instance object into a lifecycle state.
// Returns { status: 'initialized' | 'uninitialized', instance }.
// Throws InstanceMetadataError when the object is structurally invalid or
// carries a secret. A structurally invalid file is a deployment error, not an
// "uninitialized" state, so callers can distinguish the two.
export function classifyInstance(value) {
    if (!isPlainObject(value)) {
        throw new InstanceMetadataError('instance metadata must be a JSON object.');
    }
    if (value.application !== APPLICATION_ID) {
        throw new InstanceMetadataError(`instance.application must be "${APPLICATION_ID}".`);
    }
    if (value.formatVersion !== INSTANCE_FORMAT_VERSION) {
        throw new InstanceMetadataError(`instance.formatVersion must be ${INSTANCE_FORMAT_VERSION}.`);
    }
    assertNoInstanceSecrets(value);
    const initialized = value.initialized === true;
    return { status: initialized ? 'initialized' : 'uninitialized', instance: value };
}

// Fetches and classifies the public instance file for the running page.
// Never sends credentials. On a network/parse failure it returns
// { status: 'unknown' } so the shell can fall back to its normal error path
// instead of falsely claiming the instance is uninitialized.
export async function fetchInstanceState(options = {}) {
    const fetchFunction = options.fetch || globalThis.fetch?.bind(globalThis);
    const locationHref = options.locationHref || globalThis.location?.href;
    if (!fetchFunction || !locationHref) {
        return { status: 'unknown', error: new InstanceMetadataError('no fetch or location available.') };
    }
    const url = new URL(INSTANCE_URL, locationHref);
    url.searchParams.set('t', String(Date.now()));
    let response;
    try {
        response = await fetchFunction(url, {
            cache: 'no-store',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            signal: options.signal,
            headers: { Accept: 'application/json' }
        });
    } catch (error) {
        return { status: 'unknown', error };
    }
    if (!response.ok) {
        // A missing instance file means the deployment predates the contract;
        // treat it as uninitialized so visitors see the friendly notice.
        if (response.status === 404) {
            return { status: 'uninitialized', instance: null };
        }
        return { status: 'unknown', error: new InstanceMetadataError(`instance fetch failed (${response.status}).`) };
    }
    let parsed;
    try {
        parsed = await response.json();
    } catch (error) {
        return { status: 'unknown', error };
    }
    try {
        return classifyInstance(parsed);
    } catch (error) {
        return { status: 'unknown', error };
    }
}
