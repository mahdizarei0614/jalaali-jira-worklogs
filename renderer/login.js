(async function () {
    const tokenInput = document.getElementById('token');
    const btn = document.getElementById('authorize');
    const msg = document.getElementById('msg');

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
