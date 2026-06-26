import { initBackground } from './ui/background.mjs';
import { initMenu, showBlock } from './ui/menu.mjs';
import { initDashboard } from './ui/dashboard.mjs';
import { initDevices } from './ui/devices.mjs';
import { initPrices } from './ui/prices.mjs';
import { initConsumption } from './ui/consumption.mjs';
import { initWeather } from './ui/weather.mjs';
import { initHistory } from './ui/history.mjs';
import { initAlerts } from './ui/alerts.mjs';
import { initConfig } from './ui/config.mjs';
import { initMingoTouchs } from './ui/mingotouchs.mjs';
import { initSimulator } from './ui/simulator.mjs';

(async function () {
    moment.locale('es');

    // 1. Registrar listeners primero para no perder eventos iniciales
    initMenu();
    initPrices();
    initConsumption();
    initWeather();
    initHistory();
    initAlerts();
    initConfig();
    initMingoTouchs();
    initSimulator();

    // 2. Inicializar dashboard (dispara date:changed) y montar dispositivos
    initDashboard();
    await initDevices();

    // 3. Mostrar bloque inicial: ahora todos los listeners ya estan listos
    showBlock('bloque_inicio');

    // 4. Fondos de pantalla con paralaje (no bloquea)
    initBackground().catch(e => console.error('Error al iniciar fondos:', e));

    // 5. Registrar Service Worker para PWA
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js')
                .then(registration => console.log('SW registered:', registration))
                .catch(registrationError => console.log('SW registration failed:', registrationError));
        });
    }
})();
