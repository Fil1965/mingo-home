import { getJson } from '../utils/api.mjs';
import { appState } from '../utils/state.mjs';
import { emit, on } from '../utils/events.mjs';
import { html, setText } from '../utils/safe-dom.mjs';
import { formatDate, isoDate } from '../utils/helpers.mjs';

export function initDashboard() {
    loadInstallationTitle();
    setupDateArrows();
    refreshDate();

    on('block:shown', ({ blockId }) => {
        clearTimeout(appState.too);
        clearTimeout(appState.tooHistorico);

        if (blockId === 'bloque_inicio') {
            emit('devices:refresh');
        } else if (blockId === 'bloque_historico') {
            emit('history:refresh');
        } else if (blockId === 'bloque_grafico') {
            emit('consumption:refresh');
        } else if (blockId === 'bloque_config') {
            emit('config:refresh');
        } else if (blockId === 'bloque_mingotouchs') {
            emit('mingotouchs:refresh');
        }
    });
}

async function loadInstallationTitle() {
    try {
        const json = await getJson('/instalacion.json');
        if (json.GENERAL && json.GENERAL.Titulo) {
            setText($('#NombreInstalacion'), json.GENERAL.Titulo);
        }
    } catch (err) {
        if (err.status === 401) {
            window.location.href = '/login';
        }
    }
}

function setupDateArrows() {
    const shd = '1px 1px 3px rgba(16, 16, 16, .6)';

    $('.bi-arrow-bar-left').on('click', () => {
        appState.now.setDate(appState.now.getDate() - 1);
        refreshDate();
    });

    $('.bi-arrow-bar-right')
        .on({
            mouseenter: function () {
                if (!$(this).hasClass('text-body-tertiary')) {
                    $(this).css('text-shadow', shd);
                }
            },
            mouseleave: function () {
                $(this).css('text-shadow', '');
            }
        })
        .on('click', function () {
            if (!$(this).hasClass('text-body-tertiary')) {
                appState.now.setDate(appState.now.getDate() + 1);
                refreshDate();
            }
        });
}

export function refreshDate() {
    const aho = new Date();
    const fec = formatDate(appState.now);

    clearTimeout(appState.too);
    appState.dia = isoDate(appState.now);

    if (aho.toLocaleDateString() === appState.now.toLocaleDateString()) {
        $('.bi-arrow-bar-right').addClass('text-body-tertiary');
    } else {
        $('.bi-arrow-bar-right').removeClass('text-body-tertiary');
    }

    $('.dia').html(html`${fec}`);

    emit('date:changed', { dia: appState.dia });
}
