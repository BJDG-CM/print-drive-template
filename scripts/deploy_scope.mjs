#!/usr/bin/env node
// Decides whether a push can take the instance-content FAST path or must take
// the FULL verification path before deploying to GitHub Pages.
//
// FAST is allowed only when the change set is non-empty AND every changed path
// is instance content the Manager owns:
//     files/**            (manifest.enc and opaque <blob>.bin objects)
//     print-drive.instance.json
// Anything else — app/source/format/scripts/tests/docs/workflow changes,
// workflow_dispatch, the first push, an invalid "before" SHA, or a failure to
// determine the change set — takes the FULL path. The two modes are mutually
// exclusive and exactly one runs.

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const ZERO_SHA = '0'.repeat(40);
const INSTANCE_CONTENT_RE = /^(files\/.+|print-drive\.instance\.json)$/;
const SHA_RE = /^[0-9a-f]{40}$/;

function normalizePath(value) {
    return String(value).trim().replace(/^"(.*)"$/, '$1').replace(/\\/g, '/');
}

// Pure classifier: given the list of changed paths, return 'fast' or 'full'.
export function classifyChangedPaths(paths) {
    if (!Array.isArray(paths) || paths.length === 0) {
        return 'full';
    }
    const normalized = paths.map(normalizePath).filter(Boolean);
    if (normalized.length === 0) {
        return 'full';
    }
    return normalized.every((p) => INSTANCE_CONTENT_RE.test(p)) ? 'fast' : 'full';
}

// Returns a reason string when the FULL path must be forced regardless of the
// change set, or null when the change set may be inspected.
export function forceFullReason({ eventName, beforeSha } = {}) {
    if (eventName && eventName !== 'push') {
        return `event ${eventName} always runs full verification`;
    }
    if (!beforeSha || !SHA_RE.test(beforeSha) || beforeSha === ZERO_SHA) {
        return 'no valid before SHA (first push or unknown base)';
    }
    return null;
}

function diffChangedPaths(beforeSha, afterSha) {
    const output = execFileSync('git', ['diff', '--name-only', `${beforeSha}`, `${afterSha}`], {
        encoding: 'utf8'
    });
    return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

export function resolveDeployMode(context = {}) {
    const reason = forceFullReason(context);
    if (reason) {
        return { mode: 'full', reason, paths: [] };
    }
    try {
        const paths = diffChangedPaths(context.beforeSha, context.afterSha);
        const mode = classifyChangedPaths(paths);
        return {
            mode,
            reason: mode === 'fast' ? 'only instance content changed' : 'source-affecting change detected',
            paths
        };
    } catch (error) {
        return { mode: 'full', reason: `could not determine change set: ${error.message}`, paths: [] };
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const result = resolveDeployMode({
        eventName: process.env.PD_EVENT_NAME,
        beforeSha: process.env.PD_BEFORE_SHA,
        afterSha: process.env.PD_AFTER_SHA
    });
    console.log(`deploy mode: ${result.mode} (${result.reason})`);
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode}\n`);
        appendFileSync(process.env.GITHUB_OUTPUT, `reason=${result.reason}\n`);
    }
}
