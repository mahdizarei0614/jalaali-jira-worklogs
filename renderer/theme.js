(function () {
    const THEME_KEY = 'alo-worklogs:theme';
    const docEl = document.documentElement;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

    let storedPreference = null;

    try {
        const stored = localStorage.getItem(THEME_KEY);
        if (stored === 'dark' || stored === 'light') {
            storedPreference = stored;
        }
    } catch (err) {
        console.warn('Unable to read theme preference', err);
    }

    function currentPreference() {
        if (storedPreference) {
            return storedPreference;
        }
        return prefersDark.matches ? 'dark' : 'light';
    }

    function applyTheme(theme) {
        const mode = theme === 'dark' ? 'dark' : 'light';
        docEl.dataset.theme = mode;
        docEl.style.colorScheme = mode;
        if (document.body) {
            document.body.classList.toggle('is-dark', mode === 'dark');
        }
        updateToggleLabels(mode);
        return mode;
    }

    function updateToggleLabels(mode) {
        document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
            const target = btn;
            const nextMode = mode === 'dark' ? 'light' : 'dark';
            const icon = mode === 'dark' ? '🌞' : '🌙';
            target.dataset.themeState = mode;
            target.dataset.nextTheme = nextMode;
            target.setAttribute('aria-pressed', mode === 'dark' ? 'true' : 'false');
            target.setAttribute('aria-label', `Activate ${nextMode} mode`);
            if (!target.dataset.keepText) {
                target.textContent = icon;
            }
        });
    }

    function persistTheme(theme) {
        try {
            localStorage.setItem(THEME_KEY, theme);
            storedPreference = theme;
        } catch (err) {
            console.warn('Unable to store theme preference', err);
        }
    }

    function setTheme(theme) {
        const applied = applyTheme(theme);
        persistTheme(applied);
        return applied;
    }

    function toggleTheme() {
        const next = currentPreference() === 'dark' ? 'light' : 'dark';
        return setTheme(next);
    }

    function initTheme() {
        applyTheme(currentPreference());
        prefersDark.addEventListener('change', (event) => {
            if (storedPreference) {
                return;
            }
            applyTheme(event.matches ? 'dark' : 'light');
        });

        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const toggle = target.closest('[data-theme-toggle]');
            if (!toggle) return;
            event.preventDefault();
            toggleTheme();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTheme);
    } else {
        initTheme();
    }

    if (typeof window.appTheme !== 'object' || window.appTheme === null) {
        window.appTheme = {};
    }

    Object.assign(window.appTheme, {
        setTheme,
        toggleTheme,
        current: currentPreference,
        applyTheme,
    });
})();
