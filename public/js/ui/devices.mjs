import { getJson, post } from '../utils/api.mjs';
import { appState } from '../utils/state.mjs';
import { on, emit } from '../utils/events.mjs';
import { html, setHtml } from '../utils/safe-dom.mjs';
import { numberFormat, getBatteryIcon } from '../utils/helpers.mjs';

const dispositivosJson = 'dispositivos.json';

export async function initDevices() {
    await mountDevices();

    on('devices:refresh', refreshDevices);
    on('devices:remount', async () => { await mountDevices(); });
    on('date:changed', () => {
        // El bucle de dashboard ya se encarga de refrescar
    });
}

async function mountDevices() {
    try {
        const [devices, prefs] = await Promise.all([
            getJson(dispositivosJson),
            getJson('/user/prefs').catch(() => ({}))
        ]);

        const deviceList = Object.values(devices);

        if (prefs.deviceOrder && Array.isArray(prefs.deviceOrder)) {
            const orderMap = {};
            prefs.deviceOrder.forEach((id, index) => { orderMap[id] = index; });
            deviceList.sort((a, b) => {
                const indexA = orderMap[a.Id] !== undefined ? orderMap[a.Id] : 9999;
                const indexB = orderMap[b.Id] !== undefined ? orderMap[b.Id] : 9999;
                return indexA - indexB;
            });
        }

        const rows = deviceList.map(o => html`
            <div class="row pt-2 draggable${o.Switch === undefined ? '' : ' flipa'}" dsp="1" dev="${o.Id}" draggable="true">
                <div class="col device-label fw-lighter">
                    <b>${o.Nombre}</b>
                </div>
                <div class="col device-value" id="${o.Id}"></div>
            </div>
        `);

        setHtml($('#dispos'), html`<div id="device-container">${rows}</div>
        `);

        setupDeviceClick();
        setupDragAndDrop();
    } catch (e) {
        console.error('Error al montar dispositivos:', e);
    }
}

function setupDeviceClick() {
    $('.flipa')
        .off()
        .on('click', async function () {
            const row = $(this);
            const h3 = row.find('.h3');
            clearTimeout(appState.too);

            const wasOn = h3.attr('estado') === 'ON';
            setVisualState(h3, !wasOn);

            try {
                await post('/alternar/' + row.attr('dev') + '/' + row.attr('dsp'), { dsp: row.attr('dsp') });
                row.attr('dsp', row.attr('dsp') === '1' ? '0' : '1');
                emit('history:refresh');
            } catch (err) {
                setVisualState(h3, wasOn);
                const msg = err.responseJSON?.msg || err.responseJSON?.error || 'Error desconocido o dispositivo offline';
                alert('Error al controlar el dispositivo: ' + msg);
            }
        });
}

function setVisualState(h3, turnOn) {
    if (turnOn) {
        h3.removeClass('bi-' + h3.attr('iconOFF'))
            .removeClass('text-danger')
            .addClass('text-success')
            .addClass('bi-' + h3.attr('iconON'));
        h3.attr('estado', 'ON');
    } else {
        h3.removeClass('bi-' + h3.attr('iconON'))
            .removeClass('text-success')
            .addClass('text-danger')
            .addClass('bi-' + h3.attr('iconOFF'));
        h3.attr('estado', 'OFF');
    }
}

function setupDragAndDrop() {
    const container = document.getElementById('device-container');
    if (!container) return;
    const draggables = container.querySelectorAll('.draggable');

    draggables.forEach(draggable => {
        draggable.addEventListener('dragstart', () => draggable.classList.add('dragging'));
        draggable.addEventListener('dragend', () => {
            draggable.classList.remove('dragging');
            saveOrder();
        });
    });

    container.addEventListener('dragover', e => {
        e.preventDefault();
        const draggable = document.querySelector('.dragging');
        if (!draggable) return;
        const afterElement = getDragAfterElement(container, e.clientY, e.clientX);
        if (afterElement == null) {
            container.appendChild(draggable);
        } else {
            container.insertBefore(draggable, afterElement);
        }
    });
}

function getDragAfterElement(container, y, x) {
    const draggableElements = [...container.children].filter(child =>
        !child.classList.contains('dragging') &&
        (child.classList.contains('draggable') || child.classList.contains('mingo-item'))
    );

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const boxCenterX = box.left + box.width / 2;
        const boxCenterY = box.top + box.height / 2;
        const distance = Math.hypot(x - boxCenterX, y - boxCenterY);
        if (distance < closest.distance) {
            return { distance, element: child };
        }
        return closest;
    }, { distance: Number.POSITIVE_INFINITY }).element;
}

function saveOrder() {
    const ids = [];
    document.querySelectorAll('.draggable').forEach(el => ids.push(el.getAttribute('dev')));

    $.ajax({
        type: 'POST',
        url: '/user/prefs',
        data: JSON.stringify({ deviceOrder: ids }),
        contentType: 'application/json'
    });
}

async function refreshDevices() {
    if (!$('#bloque_inicio').is(':visible')) {
        emit('consumption:refresh');
        return;
    }

    if ($('.dragging').length > 0) {
        emit('consumption:refresh');
        return;
    }

    try {
        const devices = await getJson(dispositivosJson);
        const statesResponse = await getJson('/estados');

        if (!statesResponse.success || !statesResponse.result) {
            emit('consumption:refresh');
            return;
        }

        const states = statesResponse.result;

        Object.values(devices).forEach(device => {
            if ('Error' in device) {
                console.log(device);
                return;
            }
            if (!('Id' in device)) return;

            const deviceState = states[device.Id];
            let htmlOut = '';
            let flp = '';
            let est = 0;

            if (deviceState) {
                const statusList = deviceState.status;
                const isOnline = deviceState.online;

                if (!isOnline) {
                    htmlOut = html`<span class="badge bg-secondary opacity-50">
                        <i class="bi bi-wifi-off me-1"></i>Desconectado</span>`;
                    flp = 'opacity-50 text-muted pe-none';
                } else if (device.Switch !== undefined) {
                    if (device.Icon) {
                        htmlOut = html`<i class="fs-3 bi bi-${device.Icon}"></i>`;
                    } else {
                        const sw = statusList.find(s => s.code === device.Switch);
                        if (sw) {
                            if (sw.value) {
                                htmlOut = html`<i class="bi bi-${device.IconOn} h3 text-success" estado="ON" iconON="${device.IconOn}" iconOFF="${device.IconOff}"></i>`;
                                est = 0;
                            } else {
                                htmlOut = html`<i class="bi bi-${device.IconOff} h3 text-danger" estado="OFF" iconON="${device.IconOn}" iconOFF="${device.IconOff}"></i>`;
                                est = 1;
                            }
                            flp = 'flipa';
                        }
                    }
                }

                statusList.forEach(s => {
                    switch (s.code) {
                        case 'va_temperature':
                            htmlOut += html` <i class="bi bi-thermometer-half"></i>${numberFormat(s.value / 10, 1, ',', '.')}º`;
                            break;
                        case 'temp_current':
                            htmlOut += html` <i class="bi bi-thermometer-half"></i>${s.value}º`;
                            break;
                        case 'va_humidity':
                            htmlOut += html` <i class="bi bi-droplet"></i>${s.value}%`;
                            break;
                        case 'cur_voltage':
                            htmlOut += html` <i class="bi bi-lightning"></i>${numberFormat(s.value / 10, 0, ',', '.')}V`;
                            break;
                        case 'cur_current':
                            htmlOut += html` <img src="media/ampere.svg" class="svg-icon">${numberFormat(s.value / 1000, 2, ',', '.')}A`;
                            break;
                        case 'cur_power':
                            htmlOut += html` <i class="bi bi-lightning-charge-fill"></i>${numberFormat(s.value / 10, 0, ',', '.')}W`;
                            break;
                        case 'phase_a': {
                            const dec = atob(s.value);
                            htmlOut += html` <i class="bi bi-lightning"></i>${numberFormat((dec.charCodeAt(0) * 256 + dec.charCodeAt(1)) / 10, 0, ',', '.')}V
                                <img src="media/ampere.svg" class="svg-icon">${numberFormat((dec.charCodeAt(2) * 1024 + dec.charCodeAt(3) * 256 + dec.charCodeAt(4)) / 1000, 2, ',', '.')}A
                                <i class="bi bi-lightning-charge"></i>${numberFormat((dec.charCodeAt(5) * 1024 + dec.charCodeAt(6) * 256 + dec.charCodeAt(7)), 0, ',', '.')}W`;
                            break;
                        }
                        case 'power_reactive':
                            htmlOut += html` <img src="media/var.svg" class="svg-icon">${numberFormat(s.value, 0, ',', '.')}VAR`;
                            break;
                        case 'battery_state': {
                            const bat = getBatteryIcon(s.value);
                            if (bat) {
                                htmlOut += html` <i class="bi ${bat.cls} ${bat.color}"></i>`;
                            }
                            break;
                        }
                    }
                });
            }

            $('#' + device.Id)
                .html(String(htmlOut))
                .parent()
                .attr('dsp', est)
                .addClass(flp);
        });

        emit('consumption:refresh');
    } catch (e) {
        console.error('Error al refrescar dispositivos:', e);
        emit('consumption:refresh');
    }
}
