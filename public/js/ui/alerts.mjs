import { getJson, post, postJson } from '../utils/api.mjs';
import { on } from '../utils/events.mjs';
import { html, setHtml, setText } from '../utils/safe-dom.mjs';

let isAdmin = false;

export function initAlerts() {
    on('session:updated', ({ isAdmin: admin }) => {
        isAdmin = admin;
    });

    setTimeout(checkAlerts, 5000);
    setInterval(checkAlerts, 300000);

    $('#btn-acknowledge-alert').on('click', acknowledgeSingle);
    $('#btn-acknowledge-all').on('click', acknowledgeAll);
}

async function checkAlerts() {
    if (!isAdmin && !$('#menu-config').is(':visible')) return;

    try {
        const alerts = await getJson('/alerts');
        const modalEl = document.getElementById('alertModal');
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

        if (alerts && alerts.length > 0) {
            if (alerts.length === 1) {
                const alert = alerts[0];
                $('#alert-single').removeClass('d-none');
                $('#alert-multiple').addClass('d-none');
                $('#btn-acknowledge-all').addClass('d-none');
                $('#btn-acknowledge-alert').show();

                setText($('#alert-content'), alert.msg);
                setText($('#alert-time'), moment(alert.timestamp).format('LLL'));
                $('#btn-acknowledge-alert').data('id', alert.id);
            } else {
                $('#alert-single').addClass('d-none');
                $('#alert-multiple').removeClass('d-none');
                $('#btn-acknowledge-all').removeClass('d-none');
                $('#btn-acknowledge-alert').hide();

                const rows = alerts.map(alert => html`
                    <tr>
                        <td class="small">${moment(alert.timestamp).format('DD/MM HH:mm')}</td>
                        <td>${alert.msg}</td>
                        <td class="text-center">
                            <button class="btn btn-sm btn-outline-warning btn-ack-single" data-id="${alert.id}">OK</button>
                        </td>
                    </tr>
                `);
                setHtml($('#alert-table-body'), html`${rows.join('')}`);

                $('.btn-ack-single').off().on('click', async function () {
                    const id = $(this).data('id');
                    await post('/alerts/acknowledge', { id: String(id) });
                    checkAlerts();
                });
            }

            modal.show();
        } else {
            const instance = bootstrap.Modal.getInstance(modalEl);
            if (instance) instance.hide();
        }
    } catch (e) {
        console.warn('Error al consultar alertas:', e);
    }
}

async function acknowledgeSingle() {
    const id = $('#btn-acknowledge-alert').data('id');
    if (id == null) return;
    try {
        await post('/alerts/acknowledge', { id: String(id) });
        const modal = bootstrap.Modal.getInstance(document.getElementById('alertModal'));
        if (modal) modal.hide();
        setTimeout(checkAlerts, 500);
    } catch (e) {
        console.error('Error al reconocer alerta:', e);
    }
}

async function acknowledgeAll() {
    const ids = [];
    $('.btn-ack-single').each(function () {
        const id = $(this).data('id');
        if (id != null) ids.push(String(id));
    });

    if (ids.length === 0) return;

    try {
        await postJson('/alerts/acknowledge-multiple', { ids });
        const modal = bootstrap.Modal.getInstance(document.getElementById('alertModal'));
        if (modal) modal.hide();
        setTimeout(checkAlerts, 500);
    } catch (e) {
        console.error('Error al reconocer alertas:', e);
    }
}
