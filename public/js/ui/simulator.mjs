import { getJson } from '../utils/api.mjs';
import { appState } from '../utils/state.mjs';
import { on } from '../utils/events.mjs';
import { html, setHtml } from '../utils/safe-dom.mjs';
import { decodePhaseA, getSwitchStatus } from '../utils/helpers.mjs';

const PREVIEW_COLORS = {
    noche: {
        bg: '#000000',
        text: '#ffffff',
        sec: '#bdf7bf',
        accent: '#00ffff',
        div: '#420842',
        label: '#a24000',
        arrow: '#d6ce00'
    },
    dia: {
        bg: '#ffffff',
        text: '#000000',
        sec: '#422842',
        accent: '#a20000',
        div: '#ce79ce',
        label: '#d66000',
        arrow: '#a44000'
    }
};

export function initSimulator() {
    $(document).on('click', '#btn-preview-mingo', openPreview);
    $(document).on('click', '#mingo-screen', handleScreenClick);
    $(document).on('click', '#btn-preview-mode', nextMode);
    $(document).on('click', '#btn-preview-next', () => changePage(1));
    $(document).on('click', '#btn-preview-prev', () => changePage(-1));

    on('block:shown', ({ blockId }) => {
        if (blockId !== 'bloque_mingotouchs') return;
        // reset si se vuelve a la pantalla de config mingo
    });
}

function openPreview() {
    appState.previewCurrentPage = 0;
    appState.previewData = [];
    appState.previewTheme = $('#select-theme').val();

    $('#mingo-container .mingo-item').each(function () {
        const item = $(this);
        const section = item.data('section');
        const id = item.data('id');
        const name = item.find('.fw-bold').first().text();
        let type = item.find('.mingo-category-select').val();
        if (!type) {
            if (section === 'WEATHER') type = 'Weather';
            else if (section === 'ENERGY') type = 'Energy';
            else type = 'Enchufe';
        }
        appState.previewData.push({ section, id, name, type });
    });

    if (appState.previewData.length === 0) {
        alert('No hay paginas para previsualizar.');
        return;
    }

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modalPreviewMingo'));
    appState.previewViewMode = 0;
    renderPreviewPage();
    modal.show();
}

function changePage(delta) {
    const len = appState.previewData.length;
    if (len === 0) return;
    appState.previewCurrentPage = (appState.previewCurrentPage + delta + len) % len;
    renderPreviewPage();
}

function nextMode() {
    let nextMode = (appState.previewViewMode + 1) % 3;
    while (nextMode !== appState.previewViewMode) {
        if (nextMode === 0) break;
        if (nextMode === 1 && hasPreviewDevicesOfType('Luz')) break;
        if (nextMode === 2 && hasPreviewDevicesOfType('Enchufe')) break;
        nextMode = (nextMode + 1) % 3;
    }

    if (nextMode !== appState.previewViewMode) {
        appState.previewViewMode = nextMode;
        appState.previewCurrentPage = 0;
        renderPreviewPage();
    }
}

function hasPreviewDevicesOfType(type) {
    if (!appState.previewData) return false;
    const t = type.toLowerCase();
    return appState.previewData.some(d => d.type.toLowerCase() === t);
}

async function handleScreenClick(e) {
    if ($(e.target).closest('.preview-footer-btn').length || e.offsetY > 200) return;

    const gridItem = $(e.target).closest('.preview-grid-item');
    let deviceId, deviceType;

    if (gridItem.length) {
        deviceId = gridItem.data('id');
        deviceType = gridItem.data('type');
    } else if (appState.previewViewMode === 0) {
        const item = appState.previewData[appState.previewCurrentPage];
        if (!item) return;
        deviceId = item.id;
        deviceType = item.type;
    } else {
        return;
    }

    if (deviceType !== 'Enchufe' && deviceType !== 'Luz') return;

    const statusSpan = $('#preview-status-text');
    let isOn = false;

    if (gridItem.length) {
        const led = gridItem.find('div').first();
        const color = led.css('background-color');
        isOn = color.indexOf('rgb(7, 224, 7)') !== -1 || color.indexOf('rgb(255, 162, 0)') !== -1;
    } else {
        isOn = statusSpan.text() === 'ENCENDIDO';
    }

    const newState = isOn ? 0 : 1;
    const c = PREVIEW_COLORS[appState.previewTheme] || PREVIEW_COLORS.noche;

    if (statusSpan.length) {
        statusSpan.text(newState ? 'ENCENDIDO' : 'APAGADO')
            .css('color', newState ? '#07e007' : '#f80000');
        if (deviceType === 'Luz') {
            $('.bulb-icon').css('background-color', newState ? c.accent : c.div);
        } else if (deviceType === 'Enchufe') {
            $('.plug-led').css('background-color', newState ? '#07e007' : c.bg);
        }
    } else if (gridItem.length) {
        const led = gridItem.find('div').first();
        const targetColor = newState
            ? (appState.previewViewMode === 1 ? '#07e007' : '#ffa200')
            : c.div;
        led.css('background-color', targetColor);
        gridItem.addClass('active-press');
        setTimeout(() => gridItem.removeClass('active-press'), 200);
    }

    try {
        const res = await getJson(`/alternar/${deviceId}/${newState}?dsp=${newState}`);
        if (res.success) {
            setTimeout(() => renderPreviewPage(true), 3000);
        } else {
            renderPreviewPage();
        }
    } catch {
        renderPreviewPage();
    }
}

async function renderPreviewPage(dataOnly = false) {
    const screen = $('#mingo-screen');
    const item = appState.previewData[appState.previewCurrentPage];
    if (!item) return;
    const c = PREVIEW_COLORS[appState.previewTheme] || PREVIEW_COLORS.noche;
    screen.css({ 'background-color': c.bg, color: c.text });

    if (!dataOnly || screen.find('#preview-content').length === 0) {
        const htmlShell = html`
            <div style="padding: 5px; font-size: 12px; color: ${c.sec}; display: flex; justify-content: space-between;">
                <span>IP: 192.168.1.XX</span>
                <span>Pag: ${appState.previewCurrentPage + 1}/${appState.previewData.length}</span>
            </div>
            <div class="preview-separator" style="background: ${c.div};"></div>
            <div style="padding: 5px 10px; font-size: 16px; color: ${c.accent}; font-weight: bold;">
                ${item.name.toUpperCase()}
            </div>
            <div class="preview-separator" style="background: ${c.div};"></div>
            <div id="preview-content" class="p-2">
                <div class="text-center mt-3">
                    <div class="spinner-border spinner-border-sm" style="color: ${c.accent}"></div>
                    <div style="font-size: 10px; margin-top: 5px;">Cargando datos reales...</div>
                </div>
            </div>
            <div class="preview-footer">
                <div id="btn-preview-prev" class="preview-footer-btn preview-arrow-left"
                     style="visibility: ${appState.previewViewMode === 0 ? 'visible' : 'hidden'}; border-right-color: ${c.arrow};"></div>
                <span id="preview-date">--/--/----</span>
                <div id="btn-preview-mode" class="preview-footer-btn preview-mode-btn"
                     style="border-color: ${c.div}; color: ${c.accent};">
                    ${appState.previewViewMode === 0 ? 'STD' : (appState.previewViewMode === 1 ? 'LUZ' : 'PLUG')}
                </div>
                <span id="preview-time">--:--:--</span>
                <div id="btn-preview-next" class="preview-footer-btn preview-arrow-right"
                     style="visibility: ${appState.previewViewMode === 0 ? 'visible' : 'hidden'}; border-left-color: ${c.arrow};"></div>
            </div>
        `;
        setHtml(screen, htmlShell);
    }

    if (appState.previewInterval) clearInterval(appState.previewInterval);
    const updateTime = () => {
        const now = new Date();
        $('#preview-date').text(now.toLocaleDateString('es-ES'));
        $('#preview-time').text(now.toLocaleTimeString('es-ES'));
    };
    updateTime();
    appState.previewInterval = setInterval(updateTime, 1000);

    try {
        if (appState.previewViewMode === 1 || appState.previewViewMode === 2) {
            await renderGridMode(item, c);
        } else if (item.section === 'WEATHER') {
            await renderWeatherMode(c);
        } else if (item.section === 'ENERGY') {
            await renderEnergyMode(c);
        } else {
            await renderStandardMode(item, c);
        }
    } catch (e) {
        console.error('Error renderizando simulador:', e);
    }
}

async function renderGridMode(item, c) {
    const res = await getJson('/estados');
    const targetType = appState.previewViewMode === 1 ? 'luz' : 'enchufe';
    const devices = appState.previewData.filter(d => d.type.toLowerCase() === targetType);

    let innerHtml = html`<div class="preview-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; padding: 2px;">`;

    devices.forEach(d => {
        const devContainer = res.result[d.id];
        const devData = devContainer ? devContainer.status : null;
        const isOnline = devContainer ? devContainer.online : false;
        const switchStatus = getSwitchStatus(devData);
        let isOn = switchStatus ? switchStatus.value : false;
        let color = isOn ? (appState.previewViewMode === 1 ? '#07e007' : '#ffa200') : c.div;

        if (!isOnline) {
            isOn = false;
            color = '#f80000';
        }

        innerHtml += html`
            <div class="preview-grid-item" data-id="${d.id}" data-type="${d.type}" data-name="${d.name}"
                 style="opacity: ${isOnline ? 1 : 0.6}; border-color: ${c.div};">
                <div class="preview-led" style="background: ${color};"></div>
                <span class="preview-grid-label">${d.name}</span>
            </div>
        `;
    });

    innerHtml += html`</div>`;
    setHtml($('#preview-content'), innerHtml);
}

async function renderWeatherMode(c) {
    const res = await getJson('/weather/current');
    const data = res.data || {};
    const getHumColor = (h) => {
        if (h < 40) return '#f80000';
        if (h > 65) return '#001f00';
        return '#07e007';
    };

    const innerHtml = html`
        <div class="preview-weather">
            <div class="preview-row">
                <span class="preview-label" style="color: ${c.label};">Ubi.:</span>
                <span class="preview-value" style="color: ${c.text};">${data.ubi || '---'}</span>
            </div>
            <div class="preview-row">
                <i class="bi bi-thermometer-half" style="color: #f80000;"></i>
                <span class="preview-label" style="color: ${c.label};">Temp.:</span>
                <span class="preview-value preview-temp">${data.ta !== undefined ? parseFloat(data.ta).toFixed(1) : '--'} º</span>
            </div>
            <div class="preview-row">
                <i class="bi bi-droplet-fill" style="color: #0080ff;"></i>
                <span class="preview-label" style="color: ${c.label};">Humedad:</span>
                <span class="preview-value preview-hum" style="color: ${getHumColor(data.hr)};">${data.hr || '--'} %</span>
            </div>
        </div>
    `;
    setHtml($('#preview-content'), innerHtml);
}

async function renderEnergyMode(c) {
    const res = await getJson('/energy/status');
    const power = res.power;
    const price = res.price;
    const level = res.priceLevel;
    const maxPower = res.maxPower;

    let color = '#ffa200';
    if (level === 0) color = '#07e007';
    if (level === 2) color = '#f80000';

    const percentage = Math.min((power / maxPower) * 100, 100);
    const label = level === 0 ? 'HORA VALLE' : (level === 2 ? 'HORA PUNTA' : 'HORA LLANO');

    const innerHtml = html`
        <div class="preview-energy">
            <div class="preview-energy-bar" style="background: ${c.div};">
                <div class="preview-energy-fill" style="width: ${percentage}%; background: ${color};"></div>
                <div class="preview-energy-label">${label}</div>
            </div>
            <div class="preview-power" style="color: ${color};">${Math.round(power)} W</div>
            <div class="preview-price" style="color: ${c.sec};">${parseFloat(price).toFixed(2)} €/kWh</div>
        </div>
    `;
    setHtml($('#preview-content'), innerHtml);
}

async function renderStandardMode(item, c) {
    const res = await getJson('/estados');
    const devDataContainer = res.result[item.id];
    const devData = devDataContainer ? devDataContainer.status : null;
    const isOnline = devDataContainer ? devDataContainer.online : false;

    if (!isOnline) {
        setHtml($('#preview-content'), html`
            <div class="preview-offline">
                <i class="bi bi-wifi-off"></i>
                <div>DESCONECTADO</div>
            </div>
        `);
        return;
    }

    let innerHtml = '';
    const switchStatus = getSwitchStatus(devData);
    const isOn = switchStatus ? switchStatus.value : false;
    const colorLED = isOn ? '#07e007' : c.bg;

    if (item.type === 'Luz') {
        innerHtml = html`
            <div class="text-center preview-bulb-wrapper">
                <div class="preview-bulb">
                    <div class="bulb-icon" style="background: ${isOn ? c.accent : c.div};"></div>
                    <div class="preview-bulb-base" style="background: ${c.sec};"></div>
                </div>
                <div style="color: ${c.label};">
                    Estado:
                    <span id="preview-status-text" style="color: ${isOn ? '#07e007' : '#f80000'};">
                        ${isOn ? 'ENCENDIDO' : 'APAGADO'}
                    </span>
                </div>
            </div>
        `;
    } else if (item.type === 'Enchufe') {
        let powerValue = 0;
        const curPower = devData ? devData.find(d => d.code === 'cur_power') : null;
        const phaseA = devData ? devData.find(d => d.code === 'phase_a') : null;

        if (curPower) powerValue = curPower.value / 10.0;
        else if (phaseA) {
            const pa = decodePhaseA(phaseA.value);
            if (pa) powerValue = pa.power;
        }

        innerHtml = html`
            <div class="text-center mt-1 preview-plug-wrapper">
                <div class="preview-plug" style="background: ${c.div};">
                    <div class="preview-plug-pin-left" style="background: ${c.sec};"></div>
                    <div class="preview-plug-pin-right" style="background: ${c.sec};"></div>
                    <div class="plug-led" style="background: ${colorLED};"></div>
                </div>
                <div style="color: ${c.label}; margin-top: 8px;">
                    Estado:
                    <span id="preview-status-text" style="color: ${isOn ? '#07e007' : '#f80000'};">
                        ${isOn ? 'ENCENDIDO' : 'APAGADO'}
                    </span>
                </div>
                ${powerValue > 0 ? html`
                    <div style="margin-top: 6px;">
                        <span style="color: ${c.label}">Potencia:</span>
                        <span style="color: #07e007; font-weight: bold;">${powerValue.toFixed(1)} W</span>
                    </div>
                ` : ''}
            </div>
        `;
    } else if (item.type === 'Consumo') {
        const findValue = (code) => {
            const d = devData ? devData.find(x => x.code === code) : null;
            return d ? d.value : null;
        };
        const power = findValue('cur_power');
        const voltage = findValue('cur_voltage');
        const current = findValue('cur_current');
        const energy = findValue('add_ele');

        innerHtml = html`
            <div class="preview-metrics">
                <div class="preview-row">
                    <span class="preview-label" style="color: ${c.label};">Potencia:</span>
                    <span class="preview-value" style="color: #07e007;">${power !== null ? (power / 10.0).toFixed(1) : '--'} W</span>
                </div>
                <div class="preview-row">
                    <span class="preview-label" style="color: ${c.label};">Corriente:</span>
                    <span class="preview-value" style="color: #07e007;">${current !== null ? (current / 1000.0).toFixed(3) : '--'} A</span>
                </div>
                <div class="preview-row">
                    <span class="preview-label" style="color: ${c.label};">Voltaje:</span>
                    <span class="preview-value" style="color: #07e007;">${voltage !== null ? (voltage / 10.0).toFixed(1) : '--'} V</span>
                </div>
                <div class="preview-row">
                    <span class="preview-label" style="color: ${c.label};">Energia:</span>
                    <span class="preview-value" style="color: #07e007;">${energy !== null ? (energy / 1000.0).toFixed(3) : '--'} kWh</span>
                </div>
            </div>
        `;
    } else if (item.type === 'Clima') {
        const temp = devData ? devData.find(d => d.code === 'va_temperature') : null;
        const hum = devData ? devData.find(d => d.code === 'va_humidity') : null;
        const bat = devData ? devData.find(d => d.code === 'battery_state') : null;

        const getBatStatus = (val) => {
            if (val === 'low') return { text: 'Baja', color: '#f80000' };
            if (val === 'middle') return { text: 'Media', color: '#ffd200' };
            if (val === 'high') return { text: 'Alta', color: '#07e007' };
            return { text: val || '--', color: '#07e007' };
        };
        const batInfo = getBatStatus(bat ? bat.value : null);

        innerHtml = html`
            <div class="preview-metrics">
                <div class="preview-row">
                    <span class="preview-label" style="color: ${c.label};">Temperatura:</span>
                    <span class="preview-value" style="color: #fd20fd;">${temp ? (temp.value / 10.0).toFixed(1) : '--'}º</span>
                </div>
                <div class="preview-row">
                    <span class="preview-label" style="color: ${c.label};">Humedad:</span>
                    <span class="preview-value" style="color: #07e007;">${hum ? hum.value : '--'}%</span>
                </div>
                <div class="preview-row">
                    <span class="preview-label" style="color: ${c.label};">Bateria:</span>
                    <span class="preview-value" style="color: ${batInfo.color};">${batInfo.text}</span>
                </div>
            </div>
        `;
    }

    setHtml($('#preview-content'), innerHtml || html`<div class="text-center mt-4">Sin datos</div>`);
}
