(function () {
    const STORAGE_KEY = 'alo-theme';
    const root = document.documentElement;
    const mediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const listeners = new Set();

    let hasExplicitPreference = false;
    let currentTheme = 'light';

    function readStoredTheme() {
        try {
            const stored = window.localStorage.getItem(STORAGE_KEY);
            return stored === 'dark' || stored === 'light' ? stored : null;
        } catch (err) {
            return null;
        }
    }

    function writeStoredTheme(theme) {
        try {
            window.localStorage.setItem(STORAGE_KEY, theme);
        } catch (err) {
            // Ignore persistence errors (private mode, etc.)
        }
    }

    function removeStoredTheme() {
        try {
            window.localStorage.removeItem(STORAGE_KEY);
        } catch (err) {
            // Ignore persistence errors
        }
    }

    function applyTheme(theme) {
        currentTheme = theme === 'dark' ? 'dark' : 'light';
        root.dataset.theme = currentTheme;
        root.style.colorScheme = currentTheme;
    }

    function notify() {
        const theme = currentTheme;
        listeners.forEach((listener) => {
            try {
                listener(theme);
            } catch (err) {
                console.error('Theme listener failed', err);
            }
        });
    }

    function setTheme(theme) {
        const normalized = theme === 'dark' ? 'dark' : 'light';
        hasExplicitPreference = true;
        applyTheme(normalized);
        writeStoredTheme(normalized);
        notify();
    }

    function toggleTheme() {
        setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') {
            return () => {};
        }
        listeners.add(listener);
        listener(currentTheme);
        return () => listeners.delete(listener);
    }

    function clearPreference() {
        hasExplicitPreference = false;
        removeStoredTheme();
        const theme = mediaQuery && mediaQuery.matches ? 'dark' : 'light';
        applyTheme(theme);
        notify();
    }

    const stored = readStoredTheme();
    if (stored) {
        hasExplicitPreference = true;
        applyTheme(stored);
    } else if (mediaQuery && mediaQuery.matches) {
        applyTheme('dark');
    } else {
        applyTheme('light');
    }

    if (mediaQuery) {
        const handleChange = (event) => {
            if (hasExplicitPreference) {
                return;
            }
            applyTheme(event.matches ? 'dark' : 'light');
            notify();
        };
        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', handleChange);
        } else if (typeof mediaQuery.addListener === 'function') {
            mediaQuery.addListener(handleChange);
        }
    }

    notify();

    window.themeManager = {
        current: () => currentTheme,
        set: setTheme,
        toggle: toggleTheme,
        subscribe,
        clearPreference
    };
})();
