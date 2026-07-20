(() => {
    // Apply the stored theme synchronously, before the app module loads and
    // before first paint, so no screen flashes the wrong theme. theme.js
    // re-applies the identical result and wires the toggle + OS listener.
    (function applyStoredThemeEarly() {
        try {
            const raw = localStorage.getItem('print-drive-theme');
            const mode = raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
            document.documentElement.dataset.theme = mode;
            const prefersDark = window.matchMedia
                && window.matchMedia('(prefers-color-scheme: dark)').matches;
            const resolved = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta) {
                meta.setAttribute('content', resolved === 'dark' ? '#0b1220' : '#1d4ed8');
            }
        } catch {
            // A blocked localStorage/matchMedia still renders the default theme.
        }
    })();

    // Mount the theme toggle and OS listener as soon as the DOM is ready,
    // independently of whether the vault app or the uninitialized notice loads.
    const themeReady = (document.readyState === 'loading'
        ? new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
        : Promise.resolve())
        .then(() => import('./theme.js'))
        .then(({ createThemeController }) => {
            createThemeController().mount();
        })
        .catch((error) => {
            console.warn('테마 컨트롤러를 불러오지 못했습니다.', error);
        });
    void themeReady;

    let pendingShareFragment = '';
    const captureShareFragment = () => {
        if (location.hash.startsWith('#share=')) {
            pendingShareFragment = location.hash;
            history.replaceState(null, '', `${location.pathname}${location.search}`);
        }
    };
    captureShareFragment();
    window.addEventListener('hashchange', captureShareFragment);

    const releaseEarlyCapture = () => {
        window.removeEventListener('hashchange', captureShareFragment);
    };

    const domReady = document.readyState === 'loading'
        ? new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
        : Promise.resolve();

    Promise.all([import('./build_identity.js'), domReady])
        .then(async ([{ ensureCurrentBuild }]) => {
            const identity = await ensureCurrentBuild();
            if (identity.status === 'reloading') {
                return null;
            }
            if (identity.status === 'stale-after-reload') {
                const error = new Error('최신 앱 셸을 불러오지 못했습니다. 브라우저 탭을 닫고 다시 열어 주세요.');
                error.code = 'STALE_BUILD_UNRECOVERED';
                throw error;
            }
            // Public initialization gate: an instance that Print Drive Manager
            // has not initialized yet has no manifest and no vault password.
            // Show a friendly notice instead of the password form.
            const { fetchInstanceState } = await import('./instance.js');
            const state = await fetchInstanceState();
            if (state.status === 'uninitialized') {
                showUninitialized();
                return null;
            }
            // 'unknown' (transient network/parse issue) falls through to the app,
            // which surfaces its own retryable error state.
            return import('./app.js');
        })
        .then((appModule) => {
            if (!appModule) {
                return;
            }
            const { startPrintDrive } = appModule;
            captureShareFragment();
            startPrintDrive(pendingShareFragment);
            pendingShareFragment = '';
            releaseEarlyCapture();
        })
        .catch(async (error) => {
            await domReady;
            releaseEarlyCapture();
            console.error('Print Drive를 시작하지 못했습니다.', error);
            const wasPublicShare = Boolean(pendingShareFragment);
            pendingShareFragment = '';
            if (wasPublicShare) {
                clearOwnedStorage(globalThis, 'sessionStorage');
                clearOwnedStorage(globalThis, 'localStorage');
                const publicView = document.getElementById('public-share-view');
                const publicName = document.getElementById('public-file-name');
                const publicMeta = document.getElementById('public-file-meta');
                const publicBody = document.getElementById('public-preview-body');
                document.querySelectorAll('#app-root > section').forEach((section) => {
                    section.hidden = section !== publicView;
                });
                if (publicName) {
                    publicName.textContent = '공유 파일 앱을 불러오지 못했습니다';
                }
                if (publicMeta) {
                    publicMeta.textContent = '공유 fragment는 주소창에서 제거했습니다. 전체 보관함 비밀번호를 입력하지 마세요.';
                }
                if (publicBody) {
                    publicBody.textContent = '네트워크 또는 배포 파일을 확인한 뒤 원본 공유 링크를 다시 여세요.';
                }
                return;
            }
            const errorView = document.getElementById('auth-error');
            const authView = document.getElementById('auth-view');
            const modeView = document.getElementById('mode-select-view');
            if (modeView) {
                modeView.hidden = true;
            }
            if (authView) {
                authView.hidden = false;
            }
            if (errorView) {
                errorView.textContent = '앱 모듈을 불러오지 못했습니다. 네트워크와 배포 파일을 확인해 주세요.';
                errorView.hidden = false;
            }
        });

    function showUninitialized() {
        const uninitializedView = document.getElementById('uninitialized-view');
        document.querySelectorAll('#app-root > section').forEach((section) => {
            section.hidden = section !== uninitializedView;
        });
        if (uninitializedView) {
            uninitializedView.hidden = false;
        }
    }

    function clearOwnedStorage(environment, property) {
        try {
            const storage = environment[property];
            const owned = [];
            for (let index = 0; index < storage.length; index += 1) {
                const key = storage.key(index);
                if (key?.startsWith('print-drive-') && key !== 'print-drive-theme') {
                    owned.push(key);
                }
            }
            owned.forEach((key) => storage.removeItem(key));
        } catch {
            // The public error view never claims that browser storage cleanup succeeded.
        }
    }
})();
