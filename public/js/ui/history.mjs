import { getJson } from '../utils/api.mjs';
import { appState } from '../utils/state.mjs';
import { on } from '../utils/events.mjs';
import { html, raw, setHtml } from '../utils/safe-dom.mjs';

export function initHistory() {
    on('history:refresh', refreshHistory);
}

async function refreshHistory() {
    if (!$('#bloque_historico').is(':visible')) {
        appState.tooHistorico = setTimeout(() => refreshHistory(), 60000);
        return;
    }

    try {
        const json = await getJson('/log/yesterday');
        if (!Array.isArray(json) || json.length === 0) {
            setHtml($('#log'), html`<div class="text-muted">No hay entradas de log disponibles.</div>`);
        } else {
            const rows = json.map(t => `<div>${t}</div>`).join('');
            setHtml($('#log'), raw(rows));
        }

        const h = String(new Date().getHours()).padStart(2, '0');
        $('div.tarifa').removeClass('text-bg-secondary');
        $('#h_' + h).addClass('text-bg-secondary');

        appState.tooHistorico = setTimeout(() => refreshHistory(), 60000);
    } catch (e) {
        console.warn('Error al cargar historico:', e);
        setHtml($('#log'), html`<div class="alert alert-danger">Error al cargar el historico.</div>`);
        appState.tooHistorico = setTimeout(() => refreshHistory(), 60000);
    }
}
