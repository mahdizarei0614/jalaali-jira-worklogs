(async function () {
    const tokenInput = document.getElementById('token');
    const btn = document.getElementById('authorize');
    const msg = document.getElementById('msg');
    const themeToggleBtn = document.getElementById('loginThemeToggle');

    if (themeToggleBtn && window.themeController) {
        const labelNode = themeToggleBtn.querySelector('[data-theme-label]');
        const iconNode = themeToggleBtn.querySelector('.theme-toggle__icon');
        const updateToggle = (theme) => {
            const isDark = theme === 'dark';
            themeToggleBtn.setAttribute('aria-pressed', String(isDark));
            if (labelNode) {
                labelNode.textContent = isDark ? 'Light mode' : 'Dark mode';
            }
            if (iconNode) {
                iconNode.textContent = isDark ? '☀️' : '🌙';
            }
        };

        window.themeController.subscribe(updateToggle);
        updateToggle(window.themeController.getTheme());

        themeToggleBtn.addEventListener('click', () => {
            window.themeController.toggle();
        });
    }

    btn.addEventListener('click', async () => {
        msg.style.display = 'none';
        const token = tokenInput.value.trim();
        const res = await window.appApi.authorize(token);
        if (!res?.ok) {
            msg.textContent = res?.reason || 'Authorization failed.';
            msg.style.display = 'block';
        }
    });

    const has = await window.appApi.hasToken();
    if (has?.has) {
        window.location.reload();
    }
})();
