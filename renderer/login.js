(async function () {
    const tokenInput = document.getElementById('token');
    const btn = document.getElementById('authorize');
    const msg = document.getElementById('msg');
    const themeToggle = document.getElementById('themeToggle');

    if (themeToggle && window.themeManager) {
        const updateThemeToggle = (theme) => {
            const isDark = theme === 'dark';
            const label = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
            themeToggle.textContent = label;
            themeToggle.setAttribute('aria-pressed', String(isDark));
            themeToggle.setAttribute('title', label);
        };
        themeToggle.addEventListener('click', () => {
            window.themeManager.toggle();
        });
        window.themeManager.subscribe(updateThemeToggle);
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
