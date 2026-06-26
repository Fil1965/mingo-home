import { getJson, post, postJson } from '../utils/api.mjs';
import { appState } from '../utils/state.mjs';
import { on, emit } from '../utils/events.mjs';
import { html, setHtml, setText, escapeHtml } from '../utils/safe-dom.mjs';
import { TUYA_CATEGORIES } from '../utils/helpers.mjs';

const order = ['GENERAL', 'SERVER', 'USUARIOS', 'TUYA'];

export function initConfig() {
    on('config:refresh', refreshConfig);
    setupEditHandlers();
    setupRestart();
    setupCancelServer();
    setupTuyaInfo();
    setupUserDeviceHandlers();
}

async function refreshConfig() {
    if (!$('#bloque_config').is(':visible')) return;

    const container = $('#config_data');
    if (container.is(':empty') || container.children().length === 0) {
        setHtml(container, buildSkeleton());
    }

    try {
        const [a1, a2] = await Promise.all([
            getJson('/instalacion.json'),
            getJson('/estados')
        ]);
        const json = a1;
        const statesRes = a2;
        const states = (statesRes.success && statesRes.result) ? statesRes.result : {};

        if (json.SERVER && !appState.serverConfigOriginal) {
            appState.serverConfigOriginal = JSON.parse(JSON.stringify(json.SERVER));
        }

        const globals = {};
        const devices = {};
        const imagesUrl = json.TUYA ? json.TUYA.imagesUrl : '';

        Object.entries(json).forEach(([section, values]) => {
            if (section === 'Dispositivos') {
                Object.assign(devices, values);
            } else if (isNaN(section)) {
                globals[section] = values;
            } else {
                devices[section] = values;
            }
        });

        let htmlOut = html`
            <h4 class="mb-3 text-secondary border-bottom pb-2">Configuracion Global</h4>
            <div class="row row-cols-1 row-cols-md-2 g-3 mb-4">
        `;

        order.forEach(name => {
            if (globals[name]) {
                htmlOut += renderSection(name, globals[name], states, imagesUrl);
                delete globals[name];
            }
        });

        Object.entries(globals).forEach(([name, val]) => {
            htmlOut += renderSection(name, val, states, imagesUrl);
        });

        htmlOut += html`</div>
            <h4 class="mb-3 text-secondary border-bottom pb-2">Dispositivos</h4>
            <div class="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-3">
        `;

        Object.entries(devices).forEach(([name, val]) => {
            htmlOut += renderSection(name, val, states, imagesUrl);
        });

        htmlOut += html`</div>`;
        setHtml(container, htmlOut);

        if (imagesUrl) {
            loadTuyaIcons(devices, imagesUrl);
            loadTuyaInfo(devices, imagesUrl);
        }

        loadUnconfiguredDevices(devices, imagesUrl);
        checkServerChanged(json.SERVER);
    } catch (e) {
        console.error('Error al cargar configuracion:', e);
    }
}

function buildSkeleton() {
    let skel = html`
        <h4 class="mb-3 text-secondary border-bottom pb-2">
            <div class="skeleton" style="width: 200px; height: 24px;"></div>
        </h4>
        <div class="row row-cols-1 row-cols-md-2 g-3 mb-4">
    `;
    for (let i = 0; i < 4; i++) {
        skel += html`
            <div class="col">
                <div class="card h-100 shadow-sm border-0">
                    <div class="card-header skeleton py-3 mb-0"></div>
                    <div class="card-body p-2">
                        <div class="skeleton-text mb-2" style="width: 40%"></div>
                        <div class="skeleton-text mb-2" style="width: 80%"></div>
                        <div class="skeleton-text mb-2" style="width: 30%"></div>
                        <div class="skeleton-text mb-2" style="width: 60%"></div>
                    </div>
                </div>
            </div>
        `;
    }
    skel += html`</div>
        <h4 class="mb-3 text-secondary border-bottom pb-2 mt-4">
            <div class="skeleton" style="width: 150px; height: 24px;"></div>
        </h4>
        <div class="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-3">
    `;
    for (let i = 0; i < 6; i++) {
        skel += html`
            <div class="col">
                <div class="card h-100 shadow-sm border-0">
                    <div class="card-header skeleton py-3 mb-0"></div>
                    <div class="card-body p-2">
                        <div class="skeleton-text mb-2" style="width: 50%"></div>
                        <div class="skeleton-text mb-2" style="width: 90%"></div>
                    </div>
                </div>
            </div>
        `;
    }
    skel += html`</div>`;
    return skel;
}

function renderSection(section, values, states, _imagesUrl) {
    let headerHtml = '';
    let infoBtn = '';

    if (values.Protocolo === 'TuyaCloud' && values.Id) {
        const iconId = 'icon_' + section;
        headerHtml += html`<img id="${iconId}" src="" class="d-none me-2 tuya-icon" title="Icono Tuya">`;
        infoBtn = html`<i class="bi bi-info-circle info-tuya ms-2" data-id="${values.Id}" title="Info Tuya Cloud"></i>`;
    }

    if (!isNaN(section)) {
        headerHtml += html`<i class="bi bi-trash text-danger ms-auto delete-device me-2" data-section="${section}" title="Eliminar Dispositivo"></i>`;
    } else if (section === 'USUARIOS') {
        headerHtml += html`<button class="btn btn-sm btn-outline-light ms-auto me-2" id="btn-add-user">
            <i class="bi bi-person-plus"></i> Anadir
        </button>`;
    }

    headerHtml += html`<strong>${section}</strong>`;
    if (!isNaN(section) && values.Descripcion) {
        headerHtml += html` - <strong>${values.Descripcion}</strong>`;
    }

    let s = html`
        <div class="col">
            <div class="card h-100 shadow-sm">
                <div class="card-header bg-secondary text-white py-1 d-flex align-items-center">
                    ${headerHtml}${infoBtn}
                </div>
                <div class="card-body p-2">
    `;

    if (!isNaN(section)) {
        s += html`
            <div id="cloud_info_${section}" class="d-none mb-2 cloud-info"></div>
            <hr id="cloud_hr_${section}" class="d-none my-2">
        `;
        if (values.Icon === undefined) values.Icon = '';
        if (values.IconOn === undefined) values.IconOn = '';
        if (values.IconOff === undefined) values.IconOff = '';
    }

    s += html`<table class="table table-sm table-borderless mb-0 config-table">
    `;

    let isWeather = values.MostrarGrafico !== undefined;
    let isPower = values.RegistroConsumo !== undefined;

    if (!isNaN(section) && states[values.Id]) {
        const dState = states[values.Id];
        if (dState.status.find(x => ['va_temperature', 'va_humidity', 'temp_current', 'wsdcg'].includes(x.code))) {
            isWeather = true;
        }
        if (dState.status.find(x => ['cur_power', 'phase_a'].includes(x.code))) {
            isPower = true;
        }
    }

    Object.entries(values).forEach(([key, val]) => {
        if (key === 'MostrarGrafico' || key === 'MingoTouchs') return;

        let displayVal = val;
        if (section === 'USUARIOS' || key.toLowerCase().includes('secret') ||
            key.toLowerCase().includes('key') || key.toLowerCase().includes('token')) {
            displayVal = '********';
        }

        const editable = isEditable(section, key)
            ? html`<i class="bi bi-pencil-square edit-val text-primary" data-section="${section}" data-key="${key}"></i>`
            : '';
        const deleteUser = (section === 'USUARIOS')
            ? html`<i class="bi bi-trash text-danger delete-user ms-1" data-user="${key}"></i>`
            : '';

        s += html`
            <tr>
                <td class="fw-bold text-muted config-key">${key}</td>
                <td class="text-break">
                    <span id="val_${section}_${key}">${displayVal}</span>${editable}${deleteUser}
                </td>
            </tr>
        `;
    });

    if (isWeather) {
        const checked = values.MostrarGrafico === 'Si' || values.MostrarGrafico === true;
        s += renderToggle(section, 'MostrarGrafico', 'Mostrar en Grafica', checked);
    }
    if (isPower) {
        const checked = values.RegistroConsumo === 'Si' || values.RegistroConsumo === true;
        s += renderToggle(section, 'RegistroConsumo', 'Registrar Consumo', checked);
    }

    if (values.MingoTouchs && Array.isArray(values.MingoTouchs) && values.MingoTouchs.length > 0) {
        const assignedList = values.MingoTouchs.map(m => m.MTDsp).join(', ');
        s += html`
            <tr>
                <td class="text-muted assigned-label">Asignado a:</td>
                <td>
                    <div class="input-group input-group-sm">
                        <input type="text" class="form-control" value="MingoTouchs: ${assignedList}" readonly style="background-color: #f8f9fa;">
                    </div>
                </td>
            </tr>
        `;
    }

    s += html`</table></div>
    `;

    if (section === 'SERVER') {
        s += html`
            <div id="server-restart-footer" class="card-footer bg-warning bg-opacity-10 d-none d-flex justify-content-end gap-2 py-2">
                <button id="btn-cancel-server" class="btn btn-sm btn-outline-secondary">Cancelar</button>
                <button id="btn-restart" class="btn btn-sm btn-danger">
                    <i class="bi bi-arrow-clockwise"></i> Reiniciar
                </button>
            </div>
        `;
    }

    s += html`</div></div>
    `;
    return s;
}

function renderToggle(section, key, label, checked) {
    return html`
        <tr>
            <td class="fw-bold text-muted config-key">${label}</td>
            <td>
                <div class="form-check form-switch mb-0">
                    <input class="form-check-input config-toggle-chart" type="checkbox" role="switch"
                        data-section="${section}" data-key="${key}" ${checked ? 'checked' : ''}>
                </div>
            </td>
        </tr>
    `;
}

function isEditable(section, key) {
    const deviceKeys = ['Descripcion', 'Apagable', 'Carga', 'Consumo', 'Horas', 'Humedad_Maxima',
        'Icon', 'IconOn', 'IconOff', 'Esp32Pag', 'Esp32Tip', 'Esp32Dsp'];
    const generalKeys = ['Titulo', 'Retencion', 'ConsumoMaximo', 'PrecioMinimo', 'MedidorGeneral',
        'administradores', 'Coordenadas', 'AEMETApiKey', 'AEMETEstacion', 'OpenWeatherApiKey',
        'PrioridadTiempo', 'CarpetaJson'];

    return (!isNaN(section) && deviceKeys.includes(key)) ||
        (section === 'GENERAL' && generalKeys.includes(key)) ||
        section === 'USUARIOS' ||
        section === 'SERVER' ||
        section === 'TUYA';
}

function setupEditHandlers() {
    $(document).on('change', '.config-toggle-chart', async function () {
        const section = $(this).data('section');
        const key = $(this).data('key') || 'MostrarGrafico';
        const checked = $(this).is(':checked');

        try {
            await post('/config/valor', { section, key, value: checked ? 'Si' : 'No' });
            refreshConfig();
        } catch {
            alert('Error al guardar configuracion');
            refreshConfig();
        }
    });

    $(document).on('click', '.edit-val', function () {
        const section = $(this).data('section');
        const key = $(this).data('key');
        const span = $('#val_' + section + '_' + key);
        const currentVal = span.text();

        const commonAttrs = `class="editing-field form-control form-control-sm d-inline-block w-auto" data-section="${section}" data-key="${key}"`;
        const selectAttrs = `class="editing-field form-select form-select-sm d-inline-block w-auto" data-section="${section}" data-key="${key}"`;

        let input;
        if (key === 'Apagable') {
            input = html`
                <select ${selectAttrs}>
                    <option value="Si" ${currentVal === 'Si' ? 'selected' : ''}>Si</option>
                    <option value="No" ${currentVal === 'No' ? 'selected' : ''}>No</option>
                </select>`;
        } else if (key === 'Esp32Tip') {
            const tips = ['', 'Consumo', 'Clima', 'Luz', 'Enchufe'];
            const opts = tips.map(t => html`
                <option value="${t}" ${currentVal === t ? 'selected' : ''}>${t === '' ? '(Vacio)' : t}</option>`);
            input = html`<select ${selectAttrs}>${opts.join('')}</select>`;
        } else if (key === 'WebHook') {
            input = html`
                <select ${selectAttrs}>
                    <option value="Ninguno" ${currentVal === 'Ninguno' ? 'selected' : ''}>Ninguno</option>
                    <option value="ngrok" ${currentVal === 'ngrok' ? 'selected' : ''}>ngrok</option>
                </select>`;
        } else {
            input = html`<input type="text" ${commonAttrs} value="${currentVal}">`;
        }

        const saveBtn = html`<i class="bi bi-check-lg text-success ms-2 save-btn" title="Guardar todos los cambios"></i>`;

        $(this).hide();
        span.html(String(input));
        span.append(String(saveBtn));
        const field = span.find('.editing-field');
        field.focus();
        if (key !== 'Apagable' && key !== 'Esp32Tip') field.select();

        field.on('keydown', (e) => {
            if (e.which === 13) saveAllEdits();
        });
        span.find('.save-btn').on('click', saveAllEdits);
    });
}

async function saveAllEdits() {
    const edits = [];
    $('.editing-field').each(function () {
        const input = $(this);
        let val = input.val();
        if (input.attr('type') === 'checkbox') val = input.is(':checked') ? 'Si' : 'No';
        edits.push({
            section: input.data('section'),
            key: input.data('key'),
            value: val
        });
    });

    if (edits.length === 0) return;

    try {
        await Promise.all(edits.map(edit => post('/config/valor', edit)));
        refreshConfig();
        const titleEdit = edits.find(e => e.section === 'GENERAL' && e.key === 'Titulo');
        if (titleEdit) {
            setText($('#Titulo'), titleEdit.value);
        }
    } catch (err) {
        alert('Error al guardar algunos cambios. Por favor revisa la configuracion.');
        console.error(err);
        refreshConfig();
    }
}

function setupRestart() {
    $(document).on('click', '#btn-restart', async function () {
        if (!confirm('¿Estas seguro de que quieres reiniciar el servidor? Se perdera la conexion temporalmente.')) return;

        const modalEl = document.getElementById('modalRestart');
        const modal = new bootstrap.Modal(modalEl);
        modal.show();

        const progressBar = $('#restart-progress-bar');
        const timerDisplay = $('#restart-timer');
        const statusDisplay = $('#restart-status');
        const totalTime = 25;
        let currentTime = 0;
        let isRecovered = false;

        try {
            await post('/server/restart');
            console.log('Restart request accepted');

            const interval = setInterval(() => {
                if (isRecovered) return;
                currentTime++;
                const percent = (currentTime / totalTime) * 100;
                progressBar.css('width', percent + '%');
                timerDisplay.text(Math.max(0, totalTime - currentTime) + 's');

                if (currentTime >= 5 && currentTime < 15) statusDisplay.text('Deteniendo servicios...');
                if (currentTime >= 15 && currentTime < 22) statusDisplay.text('Arrancando sistema...');
                if (currentTime >= 22) statusDisplay.text('Reconectando...');

                if (currentTime >= 5) {
                    pollHealth();
                }

                if (currentTime >= totalTime) {
                    clearInterval(interval);
                    location.reload();
                }
            }, 1000);

            function pollHealth() {
                if (isRecovered) return;
                $.ajax({ url: '/health', timeout: 1000, cache: false })
                    .done((res) => {
                        if (res && res.status === 'ok') {
                            isRecovered = true;
                            statusDisplay.text('¡Conectado!');
                            progressBar.css('width', '100%');
                            timerDisplay.text('0s');
                            setTimeout(() => location.reload(), 1000);
                        } else {
                            setTimeout(pollHealth, 1500);
                        }
                    })
                    .fail(() => setTimeout(pollHealth, 1500));
            }
        } catch (err) {
            const msg = err.responseJSON?.error || 'Desconocido';
            alert('Error al reiniciar: ' + msg);
        }
    });
}

function setupCancelServer() {
    $(document).on('click', '#btn-cancel-server', async function () {
        if (!appState.serverConfigOriginal) return;
        if (!confirm('¿Revertir todos los cambios realizados en la seccion SERVER?')) return;

        try {
            await Promise.all(
                Object.entries(appState.serverConfigOriginal).map(([k, v]) =>
                    post('/config/valor', { section: 'SERVER', key: k, value: v })
                )
            );
            appState.serverConfigOriginal = null;
            refreshConfig();
        } catch {
            alert('Error al revertir cambios');
            refreshConfig();
        }
    });
}

function setupTuyaInfo() {
    $(document).on('click', '.info-tuya', async function () {
        const deviceId = $(this).data('id');
        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('tuyaInfoModal'));

        $('#tuyaLoading').removeClass('d-none');
        $('#tuyaError').addClass('d-none');
        $('#tuyaContent').addClass('d-none');
        setText($('#tuyaRawInfo'), '');

        modal.show();

        try {
            const data = await getJson('/tuya/info/' + deviceId);
            $('#tuyaLoading').addClass('d-none');
            if (data.success) {
                $('#tuyaContent').removeClass('d-none');
                setText($('#tuyaRawInfo'), JSON.stringify(data.result, null, 2));
            } else {
                $('#tuyaError').removeClass('d-none').text('Error de Tuya: ' + (data.msg || 'Desconocido'));
            }
        } catch (err) {
            $('#tuyaLoading').addClass('d-none');
            $('#tuyaError').removeClass('d-none').text('Error al consultar: ' + (err.responseJSON?.error || 'Error de conexion'));
        }
    });
}

function setupUserDeviceHandlers() {
    $(document).on('click', '#btn-add-user', async function () {
        const user = prompt('Nombre del nuevo usuario:');
        if (!user) return;
        const pass = prompt('Contrasena para ' + user + ':');
        if (!pass) return;

        try {
            await postJson('/config/usuario/anadir', { usuario: user, password: pass });
            refreshConfig();
        } catch (err) {
            alert('Error al anadir usuario: ' + (err.responseJSON?.error || 'Desconocido'));
        }
    });

    $(document).on('click', '.delete-user', async function () {
        const user = $(this).data('user');
        if (!confirm('¿Estas seguro de que quieres eliminar al usuario "' + user + '"?')) return;
        try {
            await postJson('/config/usuario/eliminar', { usuario: user });
            refreshConfig();
        } catch (err) {
            alert('Error al eliminar usuario: ' + (err.responseJSON?.error || 'Desconocido'));
        }
    });

    $(document).on('click', '.delete-device', async function () {
        const section = $(this).data('section');
        if (!confirm('¿Estas seguro de que quieres eliminar este dispositivo de la configuracion?')) return;
        try {
            await postJson('/config/dispositivo/eliminar', { section });
            refreshConfig();
            emit('devices:remount');
        } catch (err) {
            alert('Error al eliminar dispositivo: ' + (err.responseJSON?.error || 'Desconocido'));
        }
    });

    $(document).on('click', '.btn-add-device', async function (e) {
        e.preventDefault();
        const deviceId = $(this).data('id');
        const deviceName = $(this).data('name');
        if (!confirm('¿Quieres anadir "' + deviceName + '" a la configuracion local?')) return;

        try {
            const res = await postJson('/config/dispositivo/add', {
                id: deviceId,
                descripcion: deviceName,
                protocolo: 'TuyaCloud'
            });
            alert('Dispositivo anadido correctamente en la seccion [' + res.section + ']');
            refreshConfig();
            emit('devices:remount');
        } catch (err) {
            alert('Error al anadir dispositivo: ' + (err.responseJSON?.error || 'Desconocido'));
        }
    });
}

async function loadUnconfiguredDevices(devices, imagesUrl) {
    try {
        const data = await getJson('/tuya/todos');
        if (!data.success || !data.result || !data.result.list) return;

        const configuredIds = Object.values(devices)
            .filter(v => v.Id)
            .map(v => v.Id);

        const unconfigured = data.result.list.filter(d => !configuredIds.includes(d.id));
        if (unconfigured.length === 0) return;

        let cloudHtml = html`
            <h4 class="mt-5 mb-3 text-secondary border-bottom pb-2">Dispositivos en la Nube (No configurados)</h4>
            <div class="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-3">
        `;

        unconfigured.forEach(d => {
            const catDesc = TUYA_CATEGORIES[d.category] || d.category;
            const iconHtml = (d.icon && imagesUrl)
                ? html`<img src="${imagesUrl + d.icon}" class="me-2 tuya-cloud-icon" alt="${d.name}">`
                : '';
            const safeName = escapeHtml(d.name || '');

            cloudHtml += html`
                <div class="col">
                    <div class="card h-100 shadow-sm border-warning">
                        <div class="card-header bg-warning text-dark py-1 d-flex align-items-center">
                            ${iconHtml}
                            <strong>${d.name}</strong>
                        </div>
                        <div class="card-body p-2 cloud-device-body">
                            <table class="table table-sm table-borderless mb-2">
                                <tr><td class="text-muted">ID</td><td class="text-break">${d.id}</td></tr>
                                <tr><td class="text-muted">Categoria</td><td class="fw-bold">${catDesc}</td></tr>
                                <tr><td class="text-muted">Producto</td><td>${d.product_name}</td></tr>
                            </table>
                            <button class="btn btn-sm btn-success w-100 btn-add-device"
                                data-id="${d.id}" data-name="${safeName}">
                                <i class="bi bi-plus-circle me-1"></i> Anadir a Instalacion
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });

        cloudHtml += html`</div>`;
        $('#config_data').append(String(cloudHtml));
    } catch (e) {
        console.warn('Error cargando dispositivos no configurados:', e);
    }
}

function loadTuyaIcons(devices, imagesUrl) {
    Object.entries(devices).forEach(([section, values]) => {
        if (values.Protocolo === 'TuyaCloud' && values.Id) {
            getJson('/tuya/info/' + values.Id)
                .then(data => {
                    if (data.success && data.result && data.result.icon) {
                        const fullUrl = imagesUrl + data.result.icon;
                        $('#icon_' + section).attr('src', fullUrl).removeClass('d-none');
                    }
                })
                .catch(() => { /* ignore */ });
        }
    });
}

function loadTuyaInfo(devices, imagesUrl) {
    if (!imagesUrl) return;
    Object.entries(devices).forEach(([section, values]) => {
        if (values.Protocolo !== 'TuyaCloud' || !values.Id) return;

        getJson('/tuya/info/' + values.Id)
            .then(data => {
                if (!data.success || !data.result) return;
                const res = data.result;
                let cloudHtml = html`<table class="table table-sm table-borderless mb-0 cloud-info-table">`;
                let rows = 0;

                if (res.category) {
                    const catDesc = TUYA_CATEGORIES[res.category] || res.category;
                    cloudHtml += html`
                        <tr>
                            <td class="text-muted config-key">Categoria</td>
                            <td class="fw-bold text-primary">${catDesc}</td>
                        </tr>`;
                    rows++;
                }
                if (res.product_name) {
                    cloudHtml += html`<tr><td class="text-muted">Producto</td><td>${res.product_name}</td></tr>`;
                    rows++;
                }
                if (res.model) {
                    cloudHtml += html`<tr><td class="text-muted">Modelo</td><td>${res.model}</td></tr>`;
                    rows++;
                } else {
                    cloudHtml += html`<tr><td class="text-muted">Modelo</td><td>Desconocido</td></tr>`;
                    rows++;
                }
                if (res.name) {
                    cloudHtml += html`<tr><td class="text-muted">Nombre Tuya</td><td>${res.name}</td></tr>`;
                    rows++;
                }
                cloudHtml += html`</table>`;

                if (rows > 0) {
                    $('#cloud_info_' + section).html(String(cloudHtml)).removeClass('d-none');
                    $('#cloud_hr_' + section).removeClass('d-none');
                }
            })
            .catch(() => { /* ignore */ });
    });
}

function checkServerChanged(serverConfig) {
    if (!serverConfig || !appState.serverConfigOriginal) return;
    let changed = false;
    Object.entries(serverConfig).forEach(([k, v]) => {
        if (appState.serverConfigOriginal[k] !== v) changed = true;
    });
    if (changed) {
        $('#server-restart-footer').removeClass('d-none');
    }
}
