(function () {
    const STORAGE_KEY = 'alo-worklogs-theme';
    const docEl = document.documentElement;
    const systemPrefersDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const listeners = new Set();

    let currentTheme = 'light';
    let userPreference = null;

    function broadcast(theme) {
        listeners.forEach((fn) => {
            try {
                fn(theme);
            } catch (err) {
                console.error('Theme listener failed', err);
            }
        });
    }

    function applyTheme(theme, { persist = false } = {}) {
        const normalized = theme === 'dark' ? 'dark' : 'light';
        currentTheme = normalized;
        if (persist) {
            userPreference = normalized;
            try {
                localStorage.setItem(STORAGE_KEY, normalized);
            } catch (err) {
                console.warn('Unable to persist theme preference', err);
            }
        }

        docEl.dataset.theme = normalized;
        docEl.style.colorScheme = normalized === 'dark' ? 'dark' : 'light';
        broadcast(normalized);
        return normalized;
    }

    function syncFromSystem() {
        if (userPreference || !systemPrefersDark) return;
        applyTheme(systemPrefersDark.matches ? 'dark' : 'light', { persist: false });
    }

    (function initialise() {
        let storedPreference = null;
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored === 'dark' || stored === 'light') {
                storedPreference = stored;
            }
        } catch (err) {
            console.warn('Unable to read theme preference', err);
        }

        if (storedPreference) {
            userPreference = storedPreference;
            applyTheme(storedPreference, { persist: false });
        } else {
            userPreference = null;
            const initial = systemPrefersDark && systemPrefersDark.matches ? 'dark' : 'light';
            applyTheme(initial, { persist: false });
        }

        if (systemPrefersDark) {
            if (typeof systemPrefersDark.addEventListener === 'function') {
                systemPrefersDark.addEventListener('change', syncFromSystem);
            } else if (typeof systemPrefersDark.addListener === 'function') {
                systemPrefersDark.addListener(syncFromSystem);
            }
        }
    })();

    window.themeController = {
        getTheme() {
            return currentTheme;
        },
        setTheme(theme) {
            return applyTheme(theme, { persist: true });
        },
        toggle() {
            const next = currentTheme === 'dark' ? 'light' : 'dark';
            applyTheme(next, { persist: true });
            return next;
        },
        subscribe(fn) {
            if (typeof fn !== 'function') {
                return () => {};
            }
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        clearPreference() {
            userPreference = null;
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch (err) {
                console.warn('Unable to clear theme preference', err);
            }
            syncFromSystem();
        }
    };
})();
