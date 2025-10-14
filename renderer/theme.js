(function () {
    const STORAGE_KEY = 'alo-theme';
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    let manualPreference = false;
    let currentTheme = root.dataset.theme === 'dark' ? 'dark' : 'light';

    function readStoredTheme() {
        try {
            return localStorage.getItem(STORAGE_KEY);
        } catch (err) {
            console.warn('Unable to access stored theme', err);
            return null;
        }
    }

    function writeStoredTheme(theme) {
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch (err) {
            console.warn('Unable to persist theme', err);
        }
    }

    function applyTheme(theme) {
        currentTheme = theme === 'dark' ? 'dark' : 'light';
        root.dataset.theme = currentTheme;
        root.style.colorScheme = currentTheme === 'dark' ? 'dark' : 'light';
        updateToggleLabels();
    }

    function preferredTheme() {
        const stored = readStoredTheme();
        if (stored === 'dark' || stored === 'light') {
            manualPreference = true;
            return stored;
        }
        manualPreference = false;
        return mediaQuery.matches ? 'dark' : 'light';
    }

    function updateToggleLabels() {
        const isDark = currentTheme === 'dark';
        const label = isDark ? 'Light Mode' : 'Dark Mode';
        document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
            if (!(btn instanceof HTMLElement)) return;
            btn.textContent = label;
            btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
            btn.setAttribute('title', isDark ? 'Switch to light theme' : 'Switch to dark theme');
        });
    }

    function setTheme(theme, { persist = true } = {}) {
        applyTheme(theme);
        if (persist) {
            manualPreference = true;
            writeStoredTheme(currentTheme);
        }
    }

    function toggleTheme() {
        setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    }

    function resetToSystem() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (err) {
            console.warn('Unable to clear theme preference', err);
        }
        manualPreference = false;
        applyTheme(preferredTheme());
    }

    applyTheme(preferredTheme());

    document.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target.closest('[data-theme-toggle]') : null;
        if (!target) return;
        event.preventDefault();
        toggleTheme();
    });

    const handleMediaChange = (event) => {
        if (!manualPreference) {
            applyTheme(event.matches ? 'dark' : 'light');
        }
    };

    if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleMediaChange);
    } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handleMediaChange);
    }

    document.addEventListener('DOMContentLoaded', updateToggleLabels);

    window.appTheme = Object.freeze({
        current: () => currentTheme,
        set: (theme, options) => setTheme(theme, options),
        toggle: () => toggleTheme(),
        reset: () => resetToSystem()
    });
})();
