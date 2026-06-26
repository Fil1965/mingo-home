import { getJson } from '../utils/api.mjs';
import { appState } from '../utils/state.mjs';
import { on } from '../utils/events.mjs';
import { html, setHtml } from '../utils/safe-dom.mjs';

export function initWeather() {
    initWeatherWidget();
    on('date:changed', refreshWeatherChart);
    on('consumption:updated', refreshWeatherChart);
}

async function initWeatherWidget() {
    await refreshWeatherWidget();

    const now = new Date();
    const next = new Date(now);
    next.setMinutes(2, 0, 0);
    if (now.getTime() >= next.getTime()) {
        next.setHours(next.getHours() + 1);
    }
    const delay = next.getTime() - now.getTime();

    setTimeout(async () => {
        await refreshWeatherWidget();
        setInterval(refreshWeatherWidget, 3600000);
    }, delay);
}

async function refreshWeatherWidget() {
    try {
        const res = await getJson('/weather/current');
        if (res.success && res.data) {
            const d = res.data;
            const iconHtml = d.icon
                ? html`<img src="media/${d.icon}.png" class="me-1 weather-icon" alt="${d.ubi || 'clima'}">`
                : '';

            const widget = html`
                <div class="d-flex align-items-center justify-content-end">
                    ${iconHtml}
                    <div class="lh-1 text-start">
                        <div class="text-truncate weather-location">${d.ubi}</div>
                        <div class="text-white-50 small mt-1">
                            <i class="bi bi-thermometer-half"></i> ${d.ta}ºC
                            <span class="ms-1"><i class="bi bi-droplet"></i> ${d.hr}%</span>
                        </div>
                    </div>
                </div>
            `;
            setHtml($('#weather-info'), widget);
        } else {
            setHtml($('#weather-info'), html`<span class="text-white-50 small">AEMET: Sin datos</span>`);
        }
    } catch {
        $('#weather-info').empty();
    }
}

async function refreshWeatherChart() {
    if (!$('#bloque_grafico').is(':visible')) return;

    const ctx = document.getElementById('weatherChart');
    if (!ctx) return;

    try {
        const [a1, a2] = await Promise.all([
            getJson('json/' + appState.dia + '_tiempo.json'),
            getJson('/instalacion.json')
        ]);
        const json = a1;
        const instalacion = a2;

        const deviceMap = {};
        Object.entries(instalacion).forEach(([k, v]) => {
            if (k === 'Dispositivos') {
                Object.values(v).forEach(dev => {
                    if (dev && dev.Id) deviceMap[dev.Id] = dev;
                });
            } else if (v && v.Id) {
                deviceMap[v.Id] = v;
            }
        });

        const labels = [];
        for (let i = 0; i < 24; i++) labels.push(String(i).padStart(2, '0'));

        const datasets = [];
        const sensorKeys = new Set();
        const sensorNames = {};

        Object.values(json).forEach(hourData => {
            if (!hourData.sensors) return;
            Object.entries(hourData.sensors).forEach(([key, entry]) => {
                let isVisible = true;
                if (key.length > 5) {
                    const config = deviceMap[key];
                    if (config) {
                        const show = config.MostrarGrafico;
                        if (show !== 'Si' && show !== true && show !== 'true') {
                            isVisible = false;
                        }
                    } else {
                        isVisible = false;
                    }
                }

                if (isVisible) {
                    sensorKeys.add(key);
                    if (!sensorNames[key]) {
                        if (key.length > 5) {
                            const config = deviceMap[key];
                            sensorNames[key] = (config && config.Descripcion)
                                ? config.Descripcion
                                : (entry.name || key);
                        } else {
                            sensorNames[key] = entry.ubi || key;
                        }
                    }
                }
            });
        });

        const colors = [
            'rgb(255, 99, 132)', 'rgb(54, 162, 235)', 'rgb(255, 206, 86)',
            'rgb(75, 192, 192)', 'rgb(153, 102, 255)', 'rgb(255, 159, 64)'
        ];
        let colorIdx = 0;

        sensorKeys.forEach(key => {
            const dataTemp = [];
            const dataHum = [];

            for (let i = 0; i < 24; i++) {
                const h = String(i).padStart(2, '0');
                const entry = json[h] && json[h].sensors && json[h].sensors[key];
                if (entry) {
                    dataTemp.push(entry.ta !== undefined ? entry.ta : null);
                    dataHum.push(entry.hr !== undefined ? entry.hr : null);
                } else {
                    dataTemp.push(null);
                    dataHum.push(null);
                }
            }

            if (dataTemp.some(v => v !== null)) {
                datasets.push({
                    label: sensorNames[key] + ' (ºC)',
                    data: dataTemp,
                    borderColor: colors[colorIdx % colors.length],
                    backgroundColor: colors[colorIdx % colors.length],
                    yAxisID: 'yTemp',
                    tension: 0.4,
                    fill: false,
                    pointRadius: 2
                });
            }

            if (dataHum.some(v => v !== null)) {
                datasets.push({
                    label: sensorNames[key] + ' (%)',
                    data: dataHum,
                    borderColor: colors[(colorIdx + 1) % colors.length],
                    backgroundColor: colors[(colorIdx + 1) % colors.length],
                    borderDash: [5, 5],
                    yAxisID: 'yHum',
                    tension: 0.4,
                    fill: false,
                    pointRadius: 0
                });
            }

            colorIdx += 2;
        });

        if (appState.weatherChart) {
            appState.weatherChart.data.labels = labels;
            appState.weatherChart.data.datasets = datasets;
            appState.weatherChart.update('none');
        } else {
            appState.weatherChart = new Chart(ctx.getContext('2d'), {
                type: 'line',
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false
                    },
                    stacked: false,
                    plugins: { legend: { position: 'top' } },
                    scales: {
                        yHum: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            min: 0,
                            max: 100,
                            title: { display: true, text: 'Humedad %' }
                        },
                        yTemp: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            suggestedMin: 0,
                            suggestedMax: 30,
                            grid: { drawOnChartArea: false },
                            title: { display: true, text: 'Temperatura ºC' }
                        }
                    }
                },
                data: { labels, datasets }
            });
        }
    } catch {
        if (appState.weatherChart) {
            appState.weatherChart.clear();
        }
    }
}
