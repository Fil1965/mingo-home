import { fetchWeather } from '../src/managers/weather.mjs';
import { loadConfig } from '../config.mjs';
import fs from 'fs/promises';
import path from 'path';

async function testCache() {
    console.log('--- Probando Cache de Estación ---');
    try {
        const config = await loadConfig();
        const state = {
            instalacion: config.instalacion,
            dirname: config.__dirname
        };

        const cacheFile = path.join(config.__dirname, 'public', 'json', 'aemet_station_cache.json');

        // 1. Eliminar cache si existe
        try {
            await fs.unlink(cacheFile);
            console.log('Cache eliminada para la prueba.');
        } catch (e) { }

        console.log('Primera llamada (debe buscar en API):');
        await fetchWeather(state);

        // Verificar que el archivo existe
        try {
            await fs.access(cacheFile);
            console.log('Archivo de cache creado correctamente.');
            const content = await fs.readFile(cacheFile, 'utf8');
            console.log('Contenido de la cache:', content);
        } catch (e) {
            console.error('ERROR: El archivo de cache no se creó.');
        }

        console.log('\nSegunda llamada (debe usar cache):');
        await fetchWeather(state);

    } catch (error) {
        console.error('Error en la prueba:', error);
    }
}

testCache();
