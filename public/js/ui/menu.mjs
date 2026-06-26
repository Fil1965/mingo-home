import { getJson } from '../utils/api.mjs';
import { setText } from '../utils/safe-dom.mjs';
import { emit } from '../utils/events.mjs';

export function initMenu() {
    setupSessionCheck();
    setupNavigation();
    setupAbout();
    setupLogout();
    setupEscHandler();
}

function setupSessionCheck() {
    async function check() {
        try {
            const json = await getJson('/session');
            const isAdmin = !!json.isAdmin;
            $('#menu-config').toggleClass('d-none', !isAdmin);
            $('#menu-mingotouchs').toggleClass('d-none', !isAdmin);
            emit('session:updated', { isAdmin });
        } catch {
            window.location.href = '/login';
        }
    }

    check();
    setInterval(check, 60000);
}

function setupNavigation() {
    const map = {
        'menu-inicio': 'bloque_inicio',
        'menu-historico': 'bloque_historico',
        'menu-grafico': 'bloque_grafico',
        'menu-config': 'bloque_config',
        'menu-mingotouchs': 'bloque_mingotouchs',
        'menu-ayuda': 'bloque_ayuda'
    };

    Object.entries(map).forEach(([btnId, blockId]) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                showBlock(blockId);
            });
        }
    });
}

function setupAbout() {
    const btn = document.getElementById('menu-about');
    if (!btn) return;

    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        closeMenu();

        try {
            const data = await getJson('/about');
            setText($('#aboutName'), data.name);
            setText($('#aboutVersion'), 'v' + data.version);
            setText($('#aboutDescription'), data.description);
            setText($('#aboutAuthor'), 'Autor: ' + data.author);
            setText($('#aboutYear'), new Date().getFullYear());

            const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('aboutModal'));
            modal.show();
        } catch {
            alert('Error al cargar informacion de la aplicacion.');
        }
    });
}

function setupLogout() {
    const btn = document.getElementById('menu-desconectar');
    if (!btn) return;

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        closeMenu();
        setTimeout(() => { window.location.href = '/logout'; }, 320);
    });
}

function setupEscHandler() {
    $(document).on('keydown', (e) => {
        if (e.which !== 27) return;

        if ($('.editing-field').length > 0) {
            emit('config:refresh');
            return;
        }

        const menuEl = document.getElementById('mainMenu');
        const bsOffcanvas = bootstrap.Offcanvas.getInstance(menuEl);
        if (bsOffcanvas && menuEl.classList.contains('show')) {
            bsOffcanvas.hide();
        }
    });
}

export function showBlock(blockId) {
    const target = $('#' + blockId);
    $('.bloque').addClass('d-none').hide();
    target.removeClass('d-none').show();
    emit('block:shown', { blockId });
    closeMenu();
}

export function closeMenu() {
    const menuEl = document.getElementById('mainMenu');
    if (!menuEl) return;
    const off = bootstrap.Offcanvas.getInstance(menuEl) || new bootstrap.Offcanvas(menuEl);
    try { off.hide(); } catch { /* ignore */ }
}
