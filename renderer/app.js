(function () {
    const navButtons = Array.from(document.querySelectorAll('[data-route]'));
    const views = new Map(Array.from(document.querySelectorAll('[data-view]')).map((view) => [view.dataset.view, view]));
    if (!navButtons.length || !views.size) {
        return;
    }

    let currentRoute = null;
    const defaultRoute = navButtons.find((btn) => btn.classList.contains('is-active'))?.dataset.route || views.keys().next().value;

    function applyRoute(route, { updateHash = true } = {}) {
        if (!views.has(route)) {
            return;
        }
        currentRoute = route;

        navButtons.forEach((btn) => {
            const isActive = btn.dataset.route === route;
            btn.classList.toggle('is-active', isActive);
            if (isActive) {
                btn.setAttribute('aria-current', 'page');
            } else {
                btn.removeAttribute('aria-current');
            }
        });

        views.forEach((view, key) => {
            const isActive = key === route;
            view.classList.toggle('is-active', isActive);
            if (isActive) {
                view.removeAttribute('hidden');
            } else {
                view.setAttribute('hidden', 'true');
            }
        });

        if (updateHash) {
            const hash = `#${route}`;
            if (window.location.hash !== hash) {
                window.location.hash = hash;
            }
        }

        document.dispatchEvent(new CustomEvent('routechange', { detail: { route } }));
    }

    function handleNavClick(event) {
        const route = event.currentTarget?.dataset?.route;
        if (route) {
            applyRoute(route);
        }
    }

    navButtons.forEach((btn) => {
        btn.addEventListener('click', handleNavClick);
    });

    window.addEventListener('hashchange', () => {
        const route = window.location.hash.replace(/^#/, '');
        if (views.has(route)) {
            applyRoute(route, { updateHash: false });
        } else if (currentRoute == null) {
            applyRoute(defaultRoute, { updateHash: false });
        }
    });

    if (window.location.hash) {
        const initialRoute = window.location.hash.replace(/^#/, '');
        if (views.has(initialRoute)) {
            applyRoute(initialRoute, { updateHash: false });
            return;
        }
    }

    applyRoute(defaultRoute, { updateHash: false });

    window.appRouter = {
        navigate: (route) => applyRoute(route),
        current: () => currentRoute
    };
})();
