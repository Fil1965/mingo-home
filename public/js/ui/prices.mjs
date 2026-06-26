import { getJson } from '../utils/api.mjs';
import { appState } from '../utils/state.mjs';
import { on } from '../utils/events.mjs';
import { html, setHtml } from '../utils/safe-dom.mjs';
import { formatCurrency } from '../utils/helpers.mjs';

export function initPrices() {
    on('date:changed', refreshValues);
    on('consumption:updated', highlightCurrentHour);
}

async function refreshValues() {
    const url = 'json/' + appState.dia + '_rede.json';
    try {
        const json = await getJson(url);

        if (!Array.isArray(json) || json.length === 0) {
            setHtml($('#histo'), html`<div class="alert alert-warning">No hay datos de tarifa para ${appState.dia}.</div>`);
            return;
        }

        let max = 0;
        let min = 10000000;
        let tot = 0;
        const dat = [];
        const lab = [];
        const amd = [];
        const amx = [];
        const cer = [];

        json.forEach(o => {
            if (o.value < min) min = o.value;
            if (o.value > max) max = o.value;
            tot += o.value;
        });

        const med = Math.round((tot / 24) * 100) / 100;

        let s = html`
            <div class="row">
                <div class="col-1 fw-bold">Hora</div>
                <div class="col-1 fw-bold">Precio</div>
                <div class="col-2 fw-bold">Consumo</div>
                <div class="col-2 fw-bold text-center">€</div>
                <div class="col-6 fw-bold text-center">%</div>
            </div>
        `;

        json.forEach((o, k) => {
            const d = new Date(o.datetime);
            const n = formatCurrency(o.value / 1000, { fraction: 3 });
            const h = String(d.getHours()).padStart(2, '0');

            dat.push(o.value);
            lab.push(h);
            amd.push(med);
            amx.push(max);
            cer.push(0);

            s += html`
                <div id="h_${k}" class="tarifa row">
                    <div class="col-1 text-center">${h}</div>
                    <div class="col-1 text-end" val="${o.value}">${n}</div>
                    <div class="col-2 text-end"></div>
                    <div class="col-2 text-end"></div>
                    <div class="col-6">
                        <div class="grf mt-1 ${o.value > med ? 'bg-danger' : 'bg-success'}" style="width:${o.value}px;">
                            ${o.value === max ? 'MAX' : (o.value === min ? 'MIN' : ' ')}
                        </div>
                    </div>
                </div>
            `;
        });

        const medFmt = formatCurrency(med);
        s += html`
            <div id="h_24" class="row">
                <div class="col-1 fw-bold">Media</div>
                <div class="col-1">${medFmt}</div>
                <div class="col-2 text-end"><b>Total</b></div>
                <div class="col-2 text-end"></div>
                <div class="col-6">
                    <div class="grf bg-warning" style="width:${med}px;">MED</div>
                </div>
            </div>
        `;

        setHtml($('#histo'), s);
        highlightCurrentHour();
        buildChart(dat, lab, amd, amx, cer);

        // Tras pintar precios, se enciende el refresco de dispositivos/consumo
        // El modulo dashboard ya dispara devices:refresh cuando toca.
    } catch (e) {
        const status = e.status || e.readyState || '';
        if (status === 404) {
            setHtml($('#histo'), html`<div class="alert alert-warning">
                No hay datos de tarifa para ${appState.dia}.
            </div>`);
            return;
        }
        console.error('Error al cargar tarifa:', e);
        setHtml($('#histo'), html`<div class="alert alert-danger">
            Error al cargar tarifa para ${appState.dia}
            ${status ? `(HTTP ${status})` : ''}.
            <a href="#" class="alert-link" id="retry-tarifa">Reintentar</a>
        </div>`);
        $('#retry-tarifa').one('click', (ev) => {
            ev.preventDefault();
            refreshValues();
        });
    }
}

function buildChart(dat, lab, amd, amx, cer) {
    const ctx = document.getElementById('myChart');
    if (!ctx) return;

    if (appState.myChart) {
        appState.myChart.destroy();
    }

    appState.myChart = new Chart(ctx.getContext('2d'), {
        type: 'line',
        options: {
            animation: { duration: 0 },
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            stacked: false,
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left'
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    min: 0,
                    max: 5000,
                    grid: { drawOnChartArea: false }
                }
            }
        },
        data: {
            labels: lab,
            datasets: [
                {
                    label: 'Precio kW/h',
                    borderColor: 'rgba(0, 0, 0, .6)',
                    data: dat,
                    borderWidth: 3,
                    backgroundColor: 'rgba(205,205,205,0.6)',
                    fill: true,
                    tension: 0.4,
                    yAxisID: 'y',
                    order: 10
                },
                {
                    label: 'Media',
                    data: amd,
                    backgroundColor: 'rgba(105,205,105,0.6)',
                    fill: true,
                    yAxisID: 'y',
                    order: 11
                },
                {
                    label: 'Maximo',
                    data: amx,
                    backgroundColor: 'rgba(255,0,0,0.2)',
                    fill: true,
                    yAxisID: 'y',
                    order: 12
                },
                {
                    label: 'Consumo',
                    data: cer,
                    fill: false,
                    yAxisID: 'y1',
                    order: 1
                }
            ]
        }
    });
}

export function highlightCurrentHour() {
    const h = String(new Date().getHours()).padStart(2, '0');
    $('div.tarifa').removeClass('text-bg-secondary');
    $('#h_' + h).addClass('text-bg-secondary');
}
