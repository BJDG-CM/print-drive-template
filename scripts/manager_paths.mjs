// The exact repository paths Print Drive Manager is allowed to write during
// ordinary vault updates. Anything outside this allowlist — application source,
// workflows, docs — must never be rewritten by a file upload.
//
// This is the machine-readable form of docs/MANAGER_CONTRACT.md. Tests and any
// tooling that reviews a Manager-produced change should enforce it.

export const MANAGER_WRITE_PATHS = Object.freeze([
    /^print-drive\.instance\.json$/,
    /^files\/manifest\.enc$/,
    /^files\/[0-9a-f]{32}\.bin$/
]);

// Normalizes a repository-relative path to forward slashes and checks it
// against the allowlist.
export function isAllowedManagerPath(relativePath) {
    const normalized = String(relativePath).replace(/\\/g, '/').replace(/^\.\//, '');
    return MANAGER_WRITE_PATHS.some((pattern) => pattern.test(normalized));
}
