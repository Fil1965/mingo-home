import { getJson } from '../utils/api.mjs';
import { appState } from '../utils/state.mjs';
import { on, emit } from '../utils/events.mjs';
import { html, setHtml } from '../utils/safe-dom.mjs';
import { numberFormat } from '../utils/helpers.mjs';

export function initConsumption() {
    on('consumption:refresh', refreshConsumption);
}

async function refreshConsumption() {
    if (!$('#bloque_inicio').is(':visible') && !$('#bloque_grafico').is(':visible')) {
        appState.too = setTimeout(() => emit('devices:refresh'), appState.tim);
        return;
    }

    if (!appState.myChart) {
        appState.too = setTimeout(() => emit('devices:refresh'), appState.tim);
        return;
    }

    try {
        const [a1, a2] = await Promise.all([
            getJson('json/' + appState.dia + '_consumo.json'),
            getJson('/instalacion.json')
        ]);
        const json = a1;
        const instalacion = a2;

        const deviceMap = { '0': 'Consumo Total' };
        if (instalacion && instalacion.Dispositivos) {
            Object.entries(instalacion.Dispositivos).forEach(([index, v]) => {
                if (v && v.Descripcion) {
                    deviceMap[index] = v.Descripcion;
                }
            });
        } else if (instalacion) {
            Object.entries(instalacion).forEach(([k, v]) => {
                deviceMap[k] = v.Descripcion || k;
            });
        }

        const hourlyData = {};
        const allKeys = new Set(['0']);

        for (let i = 0; i < 24; i++) {
            const h = String(i).padStart(2, '0');
            if (json[h]) {
                Object.values(json[h]).forEach(val => {
                    if (typeof val === 'object' && val !== null) {
                        Object.keys(val).forEach(k => allKeys.add(k));
                    }
                });
            }
        }

        allKeys.forEach(k => { hourlyData[k] = new Array(24).fill(0); });

        for (let i = 0; i < 24; i++) {
            const h = String(i).padStart(2, '0');
            if (json[h] == undefined) continue;

            let minutesCount = 0;
            const sums = {};
            allKeys.forEach(k => { sums[k] = 0; });

            Object.values(json[h]).forEach(val => {
                minutesCount++;
                if (typeof val === 'object' && val !== null) {
                    Object.entries(val).forEach(([devId, power]) => {
                        if (sums[devId] !== undefined) sums[devId] += (power / 10);
                    });
                } else {
                    sums['0'] += (val / 10);
                }
            });

            if (minutesCount > 0) {
                allKeys.forEach(k => {
                    hourlyData[k][i] = Math.round(sums[k] / 60);
                });
            }
        }

        updatePriceTable(hourlyData['0']);
        updateChart(hourlyData, deviceMap);
        refreshDailySummary();

        emit('consumption:updated');
        appState.too = setTimeout(() => emit('devices:refresh'), appState.tim);
    } catch (e) {
        console.warn('No se pudo cargar consumo:', e);
        appState.too = setTimeout(() => emit('devices:refresh'), appState.tim * 2);
    }
}

function updatePriceTable(mainData) {
    let totalDaily = 0;
    for (let i = 0; i < 24; i++) {
        const val = mainData[i];
        const priceVal = $('#h_' + i + ' div:eq(1)').attr('val');
        const imp = parseFloat(priceVal * val / 1000 / 1000);
        const num = new Intl.NumberFormat('de-DE').format(parseInt(val));
        const eur = new Intl.NumberFormat('de-DE', {
            style: 'currency',
            currency: 'EUR',
            minimumFractionDigits: 4,
            maximumFractionDigits: 4
        }).format(imp);

        totalDaily += imp;
        $('#h_' + i + ' div:eq(2)').html(String(html`${num}`));
        $('#h_' + i + ' div:eq(3)').html(String(html`${eur}`));
    }

    $('#h_24 div:eq(3)').html(String(html`${new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR'
    }).format(totalDaily)}`));
}

function updateChart(hourlyData, deviceMap) {
    while (appState.myChart.data.datasets.length > 3) {
        appState.myChart.data.datasets.pop();
    }

    const colors = [
        '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4',
        '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080',
        '#e6beff', '#9a6324', '#fffac8', '#aaffc3', '#808000',
        '#ffd8b1', '#000075', '#808080', '#000000', '#ffffff'
    ];
    let cIdx = 0;

    if (hourlyData['0']) {
        appState.myChart.data.datasets.push({
            label: 'Consumo Total',
            data: hourlyData['0'],
            fill: false,
            borderColor: 'rgb(255, 0, 0)',
            borderWidth: 3,
            tension: 0.4,
            yAxisID: 'y1',
            order: 0
        });
    }

    Object.keys(hourlyData).forEach(k => {
        if (k === '0') return;
        if (hourlyData[k].some(x => x > 0)) {
            appState.myChart.data.datasets.push({
                label: deviceMap[k] || k,
                data: hourlyData[k],
                fill: false,
                borderColor: colors[(cIdx++) % colors.length],
                borderWidth: 2,
                backgroundColor: 'transparent',
                tension: 0.4,
                yAxisID: 'y1',
                order: 2,
                pointRadius: 2,
                pointHoverRadius: 5
            });
        }
    });

    appState.myChart.update('none');
}

async function refreshDailySummary() {
    const bloqueDiario = $('#bloque_diario');
    if (bloqueDiario.length === 0) {
        $('#bloque_precios').after(html`
            <div id="bloque_diario" class="block-panel mt-2"></div>
        `);
    }

    try {
        const parts = appState.dia.split('-');
        const res = await getJson('/consumo/diario/' + parts[0] + '/' + parts[1]);
        if (!res.success) return;

        const data = res.result;
        let nombreMes = moment(appState.dia).format('MMMM YYYY');
        nombreMes = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);

        let htmlD = html`
            <div class="block-header mb-0">Resumen Diario de Coste (${nombreMes})</div>
            <div class="p-0">
                <div class="table-responsive">
                    <table class="table table-sm table-striped text-center align-middle mb-0 mt-0 tarifa-table">
                        <thead class="table-light">
                            <tr>
                                <th>Dia</th>
                                <th>Consumo Total (kWh)</th>
                                <th>Coste Aprox. (€)</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        let totalConsumo = 0;
        let totalCoste = 0;

        data.forEach(d => {
            const kWh = d.consumo / 1000;
            totalConsumo += kWh;
            totalCoste += d.coste;

            htmlD += html`
                <tr>
                    <td>${moment(d.fecha).format('DD/MM/YYYY')}</td>
                    <td>${numberFormat(kWh, 2, ',', '.')}</td>
                    <td>${numberFormat(d.coste, 2, ',', '.')} €</td>
                </tr>
            `;
        });

        htmlD += html`
                            <tr class="table-info fw-bold">
                                <td>TOTAL MES</td>
                                <td>${numberFormat(totalConsumo, 2, ',', '.')} kWh</td>
                                <td>${numberFormat(totalCoste, 2, ',', '.')} €</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        setHtml(bloqueDiario, htmlD);
    } catch (e) {
        console.warn('Error al cargar resumen diario:', e);
    }
}
