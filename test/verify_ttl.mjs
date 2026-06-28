import { fetchWeather } from '../src/managers/weather.mjs';
import { loadConfig } from '../config.mjs';
import fs from 'fs/promises';
import path from 'path';

async function testTTL() {
    console.log('--- Probando TTL de Cache (24h) ---');
    try {
        const config = await loadConfig();
        const state = {
            instalacion: config.instalacion,
            dirname: config.__dirname
        };

        const cacheFile = path.join(config.__dirname, 'public', 'json', 'aemet_station_cache.json');

        // 1. Crear cache "vieja" (25 horas)
        const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000);
        const dummyStation = {
            idema: "3129A",
            nombre: "MADRID BARAJAS RS. (OLD)",
            cachedAt: oldTimestamp
        };

        await fs.mkdir(path.dirname(cacheFile), { recursive: true });
        await fs.writeFile(cacheFile, JSON.stringify(dummyStation, null, 2), 'utf8');
        console.log('Cache "antigua" (25h) creada.');

        console.log('\nLlamada con cache expirada (debe buscar en API):');
        await fetchWeather(state);

        // Verificar que el archivo se actualizó con un nuevo timestamp
        const content = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
        if (content.cachedAt > oldTimestamp) {
            console.log('TEST PASSED: La cache se ha actualizado correctamente.');
            console.log('Nuevo timestamp:', new Date(content.cachedAt).toLocaleString());
        } else {
            console.error('TEST FAILED: La cache no se actualizó.');
        }

    } catch (error) {
        console.error('Error en la prueba:', error);
    }
}

testTTL();
