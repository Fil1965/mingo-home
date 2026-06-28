# Weather Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move and rename `weatherManager.mjs` from the project root to `src/managers/weather.mjs`. Same public API (`fetchWeather`, `actualizarTiempo`), same behavior, same `<root>/public/json/` output paths because `state.dirname` (and the explicit `dirname` parameter on `actualizarTiempo`) point at the project root.

**Architecture:** Create the new file with **imports already corrected** (lesson from the tariff plan bug — see Task 1 below). Update 6 references (4 imports + 1 lint list + 1 backup script). Verify with a broad grep (lesson from the logger spec). Delete the old file. One commit per change for clean revertability.

**Tech Stack:** Node.js native `fs`/`fs/promises`/`path` (kept bare, not `node:` prefixed, per spec — same as tariff), `moment` 2.x, `axios` 1.x, `pino` 10.x (via `../logging/logger.mjs`), ES modules (`.mjs`).

---

## File structure

| File | Responsibility |
|------|---------------|
| `src/managers/weather.mjs` | New location of the weather manager. Identical to `weatherManager.mjs` BUT with two internal imports adjusted for the new directory depth. |
| `weatherManager.mjs` (root) | Deleted after all imports migrate. |
| `server.mjs`, `test/test_weather.mjs`, `test/verify_cache.mjs`, `test/verify_ttl.mjs` | Updated imports. |
| `eslint.config.mjs` | Updated lint files list. |
| `scripts/backup.sh` | Updated FILES array (was stale for tariff, now stale for weather). |

---

## Global Constraints

- **Project version**: `1.1.1` (package.json stays untouched).
- **File rename**: `weatherManager.mjs` → `weather.mjs`. Drop the `Manager` suffix because the file already lives in `src/managers/`. Coherent with `logger.mjs` and `tariff.mjs`.
- **Public API**: 2 named exports with unchanged names and signatures: `fetchWeather(state)`, `actualizarTiempo(tiempo, dirname)`.
- **`public/json/` paths**: `<state.dirname>/public/json/YYYY-MM-DD_tiempo.json` and `<state.dirname>/public/json/aemet_station_cache.json`. Unchanged because consumers pass the project root as `dirname`.
- **Internal imports** (CRITICAL — applied lesson from tariff spec):
  - `logger` import: `'./src/logging/logger.mjs'` → `'../logging/logger.mjs'`
  - `getTodosDispositivos` import: `'./tuyaClient.mjs'` → `'../tuyaClient.mjs'` (tuyaClient stays at root for now)
- **`moment`, `axios`, `fs/promises`, `fs`, `path` imports**: stay as-is. Bare, not `node:` prefixed (matches tariff spec — out of scope).
- **No new dependencies**.
- **Verification**: `npm test` (6 suites, none exercises weather directly — coverage is syntactic + smoke), broad grep for `weatherManager`, smoke run of `node server.mjs` to confirm `fetchWeather` writes or attempts to write the JSON file.

---

## Task 1: Create `src/managers/weather.mjs`

**Files:**
- Create: `src/managers/weather.mjs`

**CRITICAL**: The file must have the two internal imports adjusted from the start. This is the lesson from the tariff plan bug (commit `2df408d`).

- [ ] **Step 1: Create the new file**

Create `src/managers/weather.mjs` with this EXACT content. Note the two adjusted import lines (highlighted in the comments):

```js
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import moment from 'moment';
import axios from 'axios';
// ADJUSTED: was './src/logging/logger.mjs' in the root file. From src/managers/, go up one level to src/, then into logging/.
import logger from '../logging/logger.mjs';
// ADJUSTED: was './tuyaClient.mjs' in the root file. From src/managers/, go up one level to root/, where tuyaClient.mjs still lives.
import { getTodosDispositivos } from '../tuyaClient.mjs';

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
```

**REMOVE THE `// ADJUSTED:` COMMENTS BEFORE COMMITTING.** They are scaffolding for the implementer; the actual file should not have them.

After removing the comments, the relevant lines are:
```js
import logger from '../logging/logger.mjs';
import { getTodosDispositivos } from '../tuyaClient.mjs';
```

- [ ] **Step 2: Verify the file parses**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/src/managers/weather.mjs
```

Expected: no output (success).

- [ ] **Step 3: Confirm imports resolve correctly (load-time test)**

This is the critical check that the tariff plan missed. Run:
```bash
cd /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home
node --input-type=module -e "import('./src/managers/weather.mjs').then(m => console.log('exports:', Object.keys(m))).catch(e => { console.error('FAIL:', e.code, e.message); process.exit(1); })" 2>&1 | tail -3
```

Expected: `exports: [ 'fetchWeather', 'actualizarTiempo' ]`.

If `ERR_MODULE_NOT_FOUND` for `'../logging/logger.mjs'` or `'../tuyaClient.mjs'` appears, STOP and report BLOCKED — the imports were not adjusted correctly.

- [ ] **Step 4: Commit**

```bash
git add src/managers/weather.mjs
git commit -m "feat: add src/managers/weather.mjs (moved from weatherManager.mjs)"
```

---

## Task 2: Update `server.mjs` import

**Files:**
- Modify: `server.mjs:18`

- [ ] **Step 1: Change the import**

In `server.mjs`, line 18, replace:
```js
import { fetchWeather } from './weatherManager.mjs';
```
with:
```js
import { fetchWeather } from './src/managers/weather.mjs';
```

- [ ] **Step 2: Verify**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/server.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add server.mjs
git commit -m "refactor: point server.mjs to src/managers/weather.mjs"
```

---

## Task 3: Update `test/test_weather.mjs` import

**Files:**
- Modify: `test/test_weather.mjs:1`

- [ ] **Step 1: Change the import**

In `test/test_weather.mjs`, line 1, replace:
```js
import { fetchWeather } from '../weatherManager.mjs';
```
with:
```js
import { fetchWeather } from '../src/managers/weather.mjs';
```

- [ ] **Step 2: Verify**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/test/test_weather.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add test/test_weather.mjs
git commit -m "refactor: point test_weather.mjs to src/managers/weather.mjs"
```

---

## Task 4: Update `test/verify_cache.mjs` import

**Files:**
- Modify: `test/verify_cache.mjs:1`

- [ ] **Step 1: Change the import**

In `test/verify_cache.mjs`, line 1, replace:
```js
import { fetchWeather } from '../weatherManager.mjs';
```
with:
```js
import { fetchWeather } from '../src/managers/weather.mjs';
```

- [ ] **Step 2: Verify**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/test/verify_cache.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add test/verify_cache.mjs
git commit -m "refactor: point verify_cache.mjs to src/managers/weather.mjs"
```

---

## Task 5: Update `test/verify_ttl.mjs` import

**Files:**
- Modify: `test/verify_ttl.mjs:1`

- [ ] **Step 1: Change the import**

In `test/verify_ttl.mjs`, line 1, replace:
```js
import { fetchWeather } from '../weatherManager.mjs';
```
with:
```js
import { fetchWeather } from '../src/managers/weather.mjs';
```

- [ ] **Step 2: Verify**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/test/verify_ttl.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add test/verify_ttl.mjs
git commit -m "refactor: point verify_ttl.mjs to src/managers/weather.mjs"
```

---

## Task 6: Update `eslint.config.mjs` lint files list

**Files:**
- Modify: `eslint.config.mjs:26`

- [ ] **Step 1: Change the entry**

In `eslint.config.mjs`, line 26, replace the part:
```js
'weatherManager.mjs'
```
with:
```js
'src/managers/weather.mjs'
```

The full line 26 should now be:
```js
        files: ['*.mjs', 'server.mjs', 'config.mjs', 'tuyaClient.mjs', 'consumptionManager.mjs', 'src/managers/tariff.mjs', 'src/managers/weather.mjs', 'alertManager.mjs'],
```

- [ ] **Step 2: Verify the lint config parses**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/eslint.config.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add eslint.config.mjs
git commit -m "chore: update eslint config to lint src/managers/weather.mjs"
```

---

## Task 7: Update `scripts/backup.sh` FILES array

**Files:**
- Modify: `scripts/backup.sh:18`

Note: The tariff migration updated this script in commit `7e9271f` to fix `tariffManager.mjs` → `src/managers/tariff.mjs`. Now we need the same for `weatherManager.mjs`.

- [ ] **Step 1: Change the entry**

In `scripts/backup.sh`, find the line:
```bash
    "weatherManager.mjs"
```
Replace it with:
```bash
    "src/managers/weather.mjs"
```

- [ ] **Step 2: Verify the shell script syntax**

Run:
```bash
bash -n /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/scripts/backup.sh
```

Expected: no output (success). `bash -n` parses without executing.

- [ ] **Step 3: Commit**

```bash
git add scripts/backup.sh
git commit -m "chore: update scripts/backup.sh to reference src/managers/weather.mjs"
```

---

## Task 8: Verify no module still references `weatherManager`

**Files:**
- (read-only grep + tests + smoke)

- [ ] **Step 1: Broad grep — lesson from logger spec**

Run:
```bash
grep -rn "weatherManager" --include="*.mjs" --include="*.js" --include="*.sh" /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/
```

Expected: no output. Every consumer now points to `./src/managers/weather.mjs` or `../src/managers/weather.mjs`.

If any match appears, STOP and report BLOCKED with the match.

- [ ] **Step 2: Verify the old file still parses**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/weatherManager.mjs
```

Expected: no output. The old file is still valid (it imports the same modules with the old paths, which still resolve from the root). It just has no consumers anymore.

- [ ] **Step 3: Run the full test suite**

Run:
```bash
cd /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home && npm test
```

Expected: 6 suites pass. **None of them exercises weather directly** — this is syntactic coverage plus a check that no consumer broke.

- [ ] **Step 4: Smoke-run the server to confirm `fetchWeather` is reachable**

Run:
```bash
cd /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home
node server.mjs > /tmp/servidor-weather.log 2>&1 &
SERVER_PID=$!
sleep 3
ls -la public/json/*_tiempo.json 2>&1 | head -3
kill $SERVER_PID
wait $SERVER_PID 2>/dev/null
echo "--- server log: weather lines ---"
grep -i "weather\|aemet\|openweather" /tmp/servidor-weather.log | head -10
```

Expected: Either a fresh `public/json/YYYY-MM-DD_tiempo.json` OR a logged error like `[Weather] No se obtuvo clima externo ni datos de sensores locales.` OR an AEMET/OpenWeather API error (401, 429, network failure). Any of these outcomes proves the import path resolves and `fetchWeather` is being called. A `MODULE_NOT_FOUND` error means a consumer was missed — STOP and report BLOCKED.

---

## Task 9: Delete the old `weatherManager.mjs`

**Files:**
- Delete: `weatherManager.mjs` (root)

- [ ] **Step 1: Remove the file**

Run:
```bash
rm /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/weatherManager.mjs
```

- [ ] **Step 2: Verify the project still runs**

Run:
```bash
cd /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home
timeout 4 node server.mjs 2>&1 | tail -10
```

Expected: listening message, no `MODULE_NOT_FOUND` for `./weatherManager.mjs` or `../weatherManager.mjs`.

- [ ] **Step 3: Run the full test suite one more time**

Run:
```bash
cd /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home && npm test
```

Expected: 6 suites pass.

- [ ] **Step 4: Confirm the old file is gone**

Run:
```bash
ls /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/weatherManager.mjs 2>&1
```

Expected: `No such file or directory`.

- [ ] **Step 5: Final broad grep**

Run:
```bash
grep -rn "weatherManager" --include="*.mjs" --include="*.js" --include="*.sh" /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/
```

Expected: no output. Old filename fully eradicated from code.

- [ ] **Step 6: Commit**

```bash
git add -u weatherManager.mjs
git commit -m "chore: remove legacy root weatherManager.mjs after migration to src/managers/"
```

---

## Self-Review Checklist

- [x] Spec coverage: every requirement in `docs/superpowers/specs/2026-06-28-weather-migration-design.md` maps to a task (Task 1 = new file with corrected imports, Tasks 2-7 = imports/lint/backup, Task 8 = verification, Task 9 = deletion).
- [x] Placeholder scan: no "TBD", "TODO", or vague instructions. Every code step shows the exact replacement.
- [x] Type/signature consistency: same 2 named exports with same signatures. `dirname` parameter preserved.
- [x] Order: new file exists before any consumer switches to it (Task 1 → Tasks 2-7), so the project never has a broken state in git history.
- [x] Final state: only `src/managers/weather.mjs` exists; no consumer references the old path; `npm test` green.
- [x] Tariff lesson applied:
  - Task 1's brief shows imports **already adjusted** (with `// ADJUSTED:` scaffolding comments for the implementer to verify).
  - Task 1 Step 3 is a load-time test that catches any remaining `ERR_MODULE_NOT_FOUND` before committing.
  - Task 8 grep is broad (`*.mjs`, `*.js`, `*.sh`, whole tree), not narrow like the logger spec's grep.
  - Tasks 3, 4, 5 explicitly handle `test/`'s `../` prefix.
  - Task 7 explicitly updates `scripts/backup.sh` (which the tariff phase initially missed and the final review caught).