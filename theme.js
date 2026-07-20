// System / light / dark theme controller.
//
// - default is "system" (follows the OS)
// - the chosen mode persists only in localStorage["print-drive-theme"]
// - an invalid stored value is treated as "system"
// - applied via document.documentElement.dataset.theme
// - "system" reflects OS changes live; an explicit light/dark does not
// - keeps <meta name="theme-color"> in sync with the resolved theme
//
// No external fonts, frameworks, CDNs, or icon packages are used.

export const THEME_STORAGE_KEY = 'print-drive-theme';
export const THEME_MODES = Object.freeze(['system', 'light', 'dark']);

const THEME_COLORS = Object.freeze({ light: '#1d4ed8', dark: '#0b1220' });
const LABELS = Object.freeze({ system: '시스템', light: '라이트', dark: '다크' });
const ICONS = Object.freeze({
    system: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>',
    light: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8z"/></svg>'
});

// --- pure helpers (unit-tested) ---

export function normalizeTheme(value) {
    return THEME_MODES.includes(value) ? value : 'system';
}

export function resolveTheme(mode, prefersDark) {
    const normalized = normalizeTheme(mode);
    if (normalized === 'system') {
        return prefersDark ? 'dark' : 'light';
    }
    return normalized;
}

export function themeColorFor(resolved) {
    return resolved === 'dark' ? THEME_COLORS.dark : THEME_COLORS.light;
}

function safeLocalStorage(environment) {
    try {
        return environment.localStorage;
    } catch {
        return null;
    }
}

export function readStoredTheme(storage) {
    try {
        return normalizeTheme(storage?.getItem?.(THEME_STORAGE_KEY));
    } catch {
        return 'system';
    }
}

// --- controller ---

export function createThemeController(options = {}) {
    const environment = options.environment || globalThis;
    const doc = options.document || environment.document;
    const storage = options.storage !== undefined ? options.storage : safeLocalStorage(environment);
    const matchMedia = options.matchMedia || environment.matchMedia?.bind(environment);
    const query = matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
    const groups = new Set();
    let mode = readStoredTheme(storage);

    const prefersDark = () => Boolean(query?.matches);

    function reflect(group) {
        group.querySelectorAll('[data-theme-mode]').forEach((button) => {
            const pressed = button.dataset.themeMode === mode;
            button.setAttribute('aria-pressed', String(pressed));
            button.classList.toggle('is-active', pressed);
        });
    }

    function apply() {
        if (doc?.documentElement) {
            doc.documentElement.dataset.theme = mode;
        }
        const resolved = resolveTheme(mode, prefersDark());
        const meta = doc?.querySelector?.('meta[name="theme-color"]');
        if (meta) {
            meta.setAttribute('content', themeColorFor(resolved));
        }
        groups.forEach(reflect);
    }

    function setMode(next) {
        mode = normalizeTheme(next);
        try {
            storage?.setItem?.(THEME_STORAGE_KEY, mode);
        } catch {
            // A read-only storage still gets a live, in-memory theme switch.
        }
        apply();
    }

    function buildGroup() {
        const group = doc.createElement('div');
        group.className = 'theme-toggle';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', '테마 선택');
        for (const themeMode of THEME_MODES) {
            const button = doc.createElement('button');
            button.type = 'button';
            button.className = 'theme-toggle-option';
            button.dataset.themeMode = themeMode;
            button.title = `${LABELS[themeMode]} 테마`;
            button.setAttribute('aria-label', `${LABELS[themeMode]} 테마`);
            button.innerHTML = ICONS[themeMode];
            button.addEventListener('click', () => setMode(themeMode));
            group.appendChild(button);
        }
        groups.add(group);
        reflect(group);
        return group;
    }

    function mount() {
        doc?.querySelectorAll?.('[data-theme-toggle]').forEach((slot) => {
            if (slot.dataset.themeMounted === 'true') {
                return;
            }
            slot.dataset.themeMounted = 'true';
            slot.appendChild(buildGroup());
        });
    }

    const onSystemChange = () => {
        // Only "system" tracks the OS; an explicit choice stays put.
        if (mode === 'system') {
            apply();
        }
    };
    query?.addEventListener?.('change', onSystemChange);

    apply();

    return {
        getMode: () => mode,
        setMode,
        mount,
        destroy() {
            query?.removeEventListener?.('change', onSystemChange);
            groups.clear();
        }
    };
}
