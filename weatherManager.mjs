import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import moment from 'moment';
import axios from 'axios';
import logger from './src/logging/logger.mjs';
import { getTodosDispositivos } from './tuyaClient.mjs';

let nearestStationId = null;

/**
 * Obtiene el clima de OpenWeather (Fallback)
 */
async function fetchOpenWeather(lat, lon, apiKey) {
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=es`;
        logger.info(`[OpenWeather] Fetching fallback weather data...`);
        const response = await axios.get(url, { timeout: 10000 });

        if (response.data && response.data.main) {
            const data = response.data;
            return {
                idema: 'OWM',
                ubi: data.name || 'OpenWeather',
                ta: data.main.temp,
                hr: data.main.humidity,
                vis: data.visibility ? data.visibility / 1000 : undefined, // km
                pres: data.main.pressure,
                w: data.wind ? data.wind.speed : undefined, // m/s
                icon: data.weather && data.weather[0] ? data.weather[0].icon : undefined
            };
        }
    } catch (error) {
        logger.error({ err: error }, '[OpenWeather] Error fetching data:');
    }
    return null;
}

/**
 * Calcula la distancia entre dos puntos (haversine formula).
 */
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radio de la Tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Helper para realizar peticiones a AEMET con timeout y reintentos.
 */
async function fetchAemet(url, apiKey, options = {}) {
    // attempts define el número TOTAL de intentos (1 = sin reintentos)
    const maxAttempts = options.attempts || 3;
    const timeout = options.timeout || 20000;
    let lastError = null;

    for (let i = 0; i < maxAttempts; i++) {
        try {
            const response = await axios.get(url, {
                headers: { 'api_key': apiKey },
                timeout: timeout
            });
            return response;
        } catch (error) {
            lastError = error;
            const isRetryable = error.code === 'ECONNRESET' ||
                error.code === 'ECONNABORTED' ||
                error.message.includes('socket hang up') ||
                error.code === 'ETIMEDOUT' ||
                (error.response && error.response.status === 429);

            if (isRetryable && i < maxAttempts - 1) {
                const delay = (i + 1) * 2000;
                logger.warn(`[AEMET] Intento ${i + 1} fallido (${error.message}). Reintentando en ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}

/**
 * Busca la estación más cercana a las coordenadas dadas.
 * @returns {Promise<{id: string, fallback: boolean} | null>}
 */
async function findNearestStation(lat, lon, apiKey, dirname) {
    const cacheDir = path.join(dirname, 'public', 'json');
    const cacheFile = path.join(cacheDir, 'aemet_station_cache.json');
    const TTL = 24 * 60 * 60 * 1000; // 24 horas en ms
    let cachedStationId = null;

    // Intentar leer de cache
    if (existsSync(cacheFile)) {
        try {
            const cache = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
            const now = Date.now();

            if (cache && cache.idema && cache.cachedAt) {
                cachedStationId = cache.idema;
                const age = now - cache.cachedAt;
                if (age < TTL) {
                    logger.info(`[AEMET] Usando estación cacheada: ${cache.nombre} (${cache.idema}) - Antigüedad: ${(age / 3600000).toFixed(1)}h`);
                    return { id: cache.idema, fallback: false };
                } else {
                    logger.info(`[AEMET] La cache de estación ha expirado (Antigüedad: ${(age / 3600000).toFixed(1)}h)`);
                }
            }
        } catch (err) {
            logger.warn('[AEMET] Error leyendo cache de estación:', err.message);
        }
    }

    try {
        logger.info(`[AEMET] Buscando estación más cercana a ${lat}, ${lon}...`);
        const url = 'https://opendata.aemet.es/opendata/api/observacion/convencional/todas';
        const response = await fetchAemet(url, apiKey);

        if (response.data && response.data.datos) {
            const dataResponse = await axios.get(response.data.datos, { timeout: 20000 });
            const stations = dataResponse.data;

            let minDist = Infinity;
            let closest = null;

            stations.forEach(s => {
                const dist = getDistance(lat, lon, s.lat, s.lon);
                if (dist < minDist) {
                    minDist = dist;
                    closest = s;
                }
            });

            if (closest) {
                logger.info(`[AEMET] Estación más cercana: ${closest.nombre} (${closest.idema}) a ${minDist.toFixed(2)} km`);

                // Guardar en cache con timestamp
                try {
                    closest.cachedAt = Date.now();
                    await fs.mkdir(cacheDir, { recursive: true });
                    await fs.writeFile(cacheFile, JSON.stringify(closest, null, 2), 'utf8');
                } catch (err) {
                    logger.error({ err: err }, '[AEMET] Error al guardar cache de estación:');
                }

                return { id: closest.idema, fallback: false };
            }
        }
    } catch (error) {
        if (error.response && error.response.status === 429) {
            logger.error('[AEMET] Error buscando estaciones: Request failed with status code 429');
        } else {
            logger.error({ err: error }, '[AEMET] Error buscando estaciones:');
        }

        // Fallback a cache expirada si existe
        if (cachedStationId) {
            logger.warn(`[AEMET] Usando estación de cache expirada como fallback: ${cachedStationId} (La API de búsqueda no responde)`);
            return { id: cachedStationId, fallback: true };
        }
    }
    return null;
}

/**
 * Guarda los datos del clima en un fichero JSON siguiendo la lógica de consumos.
 */
export async function actualizarTiempo(tiempo, dirname) {
    const hoy = new Date();
    const dia = moment().format('YYYY-MM-DD');
    const hor = hoy.getHours().toString().padStart(2, '0');
    const jsonDir = path.join(dirname, 'public', 'json');
    const fic = path.join(jsonDir, `${dia}_tiempo.json`);

    try {
        await fs.mkdir(jsonDir, { recursive: true });
        let json;
        try {
            const data = await fs.readFile(fic, 'utf8');
            json = JSON.parse(data);
        } catch (err) {
            logger.info('Creando fichero de tiempo');
            json = {
                "00": {}, "01": {}, "02": {}, "03": {}, "04": {}, "05": {},
                "06": {}, "07": {}, "08": {}, "09": {}, "10": {}, "11": {},
                "12": {}, "13": {}, "14": {}, "15": {}, "16": {}, "17": {},
                "18": {}, "19": {}, "20": {}, "21": {}, "22": {}, "23": {},
            };
        }

        json[hor] = tiempo;
        await fs.writeFile(fic, JSON.stringify(json, null, 2), 'utf8');
        logger.info(`[Weather] Tiempo actualizado (AEMET) para la hora ${hor}`);
    } catch (error) {
        logger.error({ err: error }, 'Error actualizando tiempo en JSON:');
    }
}

/**
 * Obtiene datos de sensores locales asociados a dispositivos Tuya.
 * @param {Object} state Estado de la aplicación
 * @returns {Promise<Object>} Mapa de sensores { id: data }
 */
async function getLocalSensorsData(state) {
    const sensorsMap = {};
    if (!state.uid || !state.instalacion) return sensorsMap;

    try {
        const tuyaResponse = await getTodosDispositivos(state.uid);
        if (!tuyaResponse.success || !Array.isArray(tuyaResponse.result.list || tuyaResponse.result)) {
            return sensorsMap;
        }

        const devicesList = tuyaResponse.result.list || tuyaResponse.result;

        // Recorrer configuración
        // Recorrer configuración (Dispositivos)
        if (state.instalacion.Dispositivos) {
            Object.keys(state.instalacion.Dispositivos).forEach(key => {
                const config = state.instalacion.Dispositivos[key];
                if (config.Id && (config.Temperatura || config.Humedad)) {

                    const deviceStatus = devicesList.find(d => d.id === config.Id);
                    if (deviceStatus && deviceStatus.status) {
                        const sensorData = {};
                        let hasData = false;

                        if (config.Temperatura) {
                            const tStatus = deviceStatus.status.find(s => s.code === config.Temperatura);
                            if (tStatus) {
                                let val = tStatus.value;
                                if (config.TemperaturaDiv) {
                                    val = val / parseFloat(config.TemperaturaDiv);
                                }
                                sensorData.ta = val;
                                hasData = true;
                            }
                        }

                        if (config.Humedad) {
                            const hStatus = deviceStatus.status.find(s => s.code === config.Humedad);
                            if (hStatus) {
                                sensorData.hr = hStatus.value;
                                hasData = true;
                            }
                        }

                        if (hasData) {
                            sensorsMap[config.Id] = sensorData;
                        }
                    }
                }
            });
        }

    } catch (err) {
        logger.error({ err: err }, '[Weather] Error obteniendo sensores locales:');
    }

    return sensorsMap;
}

/**
 * Obtiene el clima actual de AEMET.
 */
export async function fetchWeather(state) {
    const { instalacion, dirname } = state;
    const general = instalacion.GENERAL;

    if (!general.Coordenadas) {
        logger.warn('[Weather] Falta Coordenadas en instalacion.ini');
        return false;
    }

    const [lat, lon] = general.Coordenadas.split(',').map(c => parseFloat(c.trim()));
    const aemetKey = general.AEMETApiKey;
    const owKey = general.OpenWeatherApiKey;

    const priority = (general.PrioridadTiempo || 'AEMET,OpenWeather')
        .split(',')
        .map(p => p.trim())
        .filter(p => p);

    logger.info(`[Weather] Orden de prioridad: ${priority.join(' -> ')}`);

    let mainWeatherData = null;

    // 1. Obtener Clima Externo
    for (const provider of priority) {
        if (provider === 'AEMET') {
            if (!aemetKey) {
                logger.info('[Weather] Saltando AEMET (falta API Key)');
                continue;
            }

            // Lógica AEMET
            let nearestStationId = null;
            let fallbackUsed = false;

            if (general.AEMETEstacion) {
                nearestStationId = general.AEMETEstacion;
                logger.info(`[AEMET] Usando estación configurada: ${nearestStationId}`);
            } else {
                const stationInfo = await findNearestStation(lat, lon, aemetKey, dirname);
                if (stationInfo) {
                    nearestStationId = stationInfo.id;
                    fallbackUsed = stationInfo.fallback;
                }
            }

            if (nearestStationId) {
                try {
                    const url = `https://opendata.aemet.es/opendata/api/observacion/convencional/datos/estacion/${nearestStationId}`;
                    const options = fallbackUsed ? { attempts: 1 } : {};
                    const response = await fetchAemet(url, aemetKey, options);

                    if (response.data && response.data.datos) {
                        const dataResponse = await axios.get(response.data.datos, { timeout: 20000 });
                        const observations = dataResponse.data;
                        if (observations && observations.length > 0) {
                            mainWeatherData = observations[observations.length - 1];
                            break;
                        }
                    } else {
                        logger.error('[AEMET] La API no devolvió URL de datos');
                    }
                } catch (error) {
                    logger.error({ err: error }, '[AEMET] Error al consultar datos:');
                }
            }
        }

        else if (provider === 'OpenWeather') {
            if (!owKey) {
                logger.info('[Weather] Saltando OpenWeather (falta API Key)');
                continue;
            }

            logger.info('[Weather] Intentando obtención con OpenWeather...');
            mainWeatherData = await fetchOpenWeather(lat, lon, owKey);
            if (mainWeatherData) break;
        }
    }

    // 2. Obtener Sensores Locales
    const localSensors = await getLocalSensorsData(state);

    if (!mainWeatherData && Object.keys(localSensors).length === 0) {
        logger.error('[Weather] No se obtuvo clima externo ni datos de sensores locales.');
        return false;
    }

    // 3. Estructurar Datos (Nueva Estructura)
    const finalStructure = {
        sensors: {}
    };

    if (mainWeatherData) {
        // Usar idema como clave, o 'External' si no existe
        const key = mainWeatherData.idema || 'External';
        finalStructure.sensors[key] = mainWeatherData;
    }

    if (Object.keys(localSensors).length > 0) {
        Object.assign(finalStructure.sensors, localSensors);
        logger.info(`[Weather] Insertados ${Object.keys(localSensors).length} sensores locales.`);
    }

    // 4. Guardar
    await actualizarTiempo(finalStructure, dirname);
    return true;
}
