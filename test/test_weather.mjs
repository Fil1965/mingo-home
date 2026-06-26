import { fetchWeather } from '../weatherManager.mjs';
import { loadConfig } from '../config.mjs';

async function test() {
    console.log('--- Probando integración con OpenWeather ---');
    try {
        const config = await loadConfig();
        // Mimic the state object used in server.mjs
        const state = {
            instalacion: config.instalacion,
            dirname: config.__dirname
        };

        console.log('Llamando a fetchWeather...');
        await fetchWeather(state);
        console.log('Prueba finalizada. Revisa la carpeta public/json');
    } catch (error) {
        console.error('Error en la prueba:', error);
    }
}

test();
