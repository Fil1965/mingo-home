# Diseño: Migración de `tuyaClient.mjs` a `src/api/tuya/client.mjs`

## Resumen

Mover y renombrar `tuyaClient.mjs` desde la raíz a `src/api/tuya/client.mjs`. Misma API pública (9 exports), mismo comportamiento, mismo estado módulo-level (cache de token + config inyectada por `initTuya`). El archivo tiene un único import relativo interno (`./src/logging/logger.mjs`) que hay que recalcular a la nueva profundidad (`../../logging/logger.mjs`).

**Lección consolidada de las fases previas** (logger, tariff, weather): el archivo se crea con los imports **ya corregidos** desde el inicio, y el Task 1 del plan hace un **load-time test explícito** (`node -e "import(...)"`) que atrapa cualquier path geométrico mal calculado antes de cualquier commit. Esto se aplica con disciplina en este spec.

## Contexto

`tuyaClient.mjs` implementa el cliente HTTP firmado contra el cloud de Tuya. No es lógica de negocio (no es un "manager"); es capa de infraestructura — un **cliente HTTP con estado** (cache de access token + deduplicación de llamadas concurrentes vía `tokenPromise`).

Funciones exportadas (9):
- `initTuya(tuyaConfig)` — inyecta config (accessKey, secretKey, baseUrl) en el módulo.
- `API_PATHS` — constante con paths de la API Tuya (token, info, userDevices, allDevices, commands, functions, status).
- `makeRequest(path, method, body)` — wrapper HTTP con firma HMAC-SHA256 y cache de token.
- `getEstado(deviceId)` — status de un dispositivo.
- `getInfo(deviceId)` — info detallada de un dispositivo.
- `getTodosDispositivos(uid)` — bulk list; usa `/users/{uid}/devices` si hay UID, fallback a `/iot-03/devices` si no.
- `detectUid(identificadores)` — itera hasta 3 IDs, devuelve el primero cuyo `/info` traiga `result.uid`.
- `alternar(deviceId, state, instalacion, identificadores)` — POST `/commands` con `{ commands: [{ code, value }] }`.
- `getSwitchValue(response, interruptor)` — helper puro: extrae `value` de un item de `response.result` por code.

Funciones internas (no exportadas): `calculateSign` (HMAC-SHA256 de la firma Tuya V2), `getAccessToken` (cache + dedup de token).

Dependencias externas (en orden de aparición):
- `axios` — sin cambios.
- `crypto` (built-in) — sin cambios.
- `logger` — ya migrado a `src/logging/logger.mjs`. **Este es el único import relativo interno que hay que recalcular.**

## Consumidores

Tres archivos importan desde `tuyaClient.mjs` (consumidores activos):

- `server.mjs:16` — `initTuya, getEstado, getInfo, getTodosDispositivos, alternar, API_PATHS, makeRequest, detectUid` (8 de 9 exports).
- `consumptionManager.mjs:5` — `getEstado, alternar, getSwitchValue, getTodosDispositivos` (4 exports). Sigue en la raíz por ahora.
- `src/managers/weather.mjs:7` — `getTodosDispositivos` (1 export). Ya migrado en fase 3.

Tres referencias más (housekeeping, no son consumidores):
- `eslint.config.mjs:26` — `'tuyaClient.mjs'` en la lista de files del lint.
- `scripts/backup.sh:20` — `"tuyaClient.mjs"` en el array FILES.
- `server.mjs:505` — línea **comentada** (referencia histórica a una versión previa). No se actualiza.

## Decisiones de diseño

- **Mover y renombrar simultáneamente**: `tuyaClient.mjs` → `src/api/tuya/client.mjs`. Drop del prefijo `tuya` porque ya vive en `src/api/tuya/`. Coherente con `logger.mjs` (en `src/logging/`) y `weather.mjs` (en `src/managers/`). El archivo NO tiene sufijo `Manager`, así que no hay nada más que recortar.
- **API pública intacta**: los 9 exports mantienen nombre y firma. Ningún cambio funcional.
- **Estado módulo-level se conserva tal cual**: `config`, `token`, `tokenExpireTime`, `tokenPromise` siguen siendo variables a nivel de módulo. La deduplicación de llamadas concurrentes al endpoint de token y el cache del access_token siguen funcionando igual.
- **Imports internos recalculados desde el inicio** (lección consolidada de las 3 fases previas):
  - `logger from './src/logging/logger.mjs'` → `logger from '../../logging/logger.mjs'`. Desde `src/api/tuya/`, dos niveles arriba llegan a la raíz del proyecto, luego `logging/logger.mjs` está un nivel adentro de `src/`.
- **Imports externos sin tocar**: `axios`, `crypto` (built-ins). Sin cambios.
- **Sin inyección de dependencias**: el patrón `setDependencies({ axios })` que `consumptionManager.mjs` ya tiene NO se introduce aquí. Si en el futuro queremos testear `tuyaClient` mockeando `axios`, será un spec aparte. Esto preserva paridad con las 3 fases previas (todas "solo mover").
- **Sin tests dedicados**: paridad con `logger`, `tariff`, `weather`. `npm test` mantiene su cobertura sintáctica + smoke actual.
- **Verificación con grep amplio**: el plan busca `tuyaClient` por todo el árbol `*.mjs`, `*.js`, `*.sh`, igual que las fases previas. La línea comentada en `server.mjs:505` se IGNORA (es un comentario histórico).
- **Orden de cambios seguro**: el archivo nuevo se crea PRIMERO (Task 1), luego los consumers van cambiando uno a uno (Tasks 2-4). En ningún momento el repo queda en estado roto.

## Archivos a crear

- `src/api/tuya/client.mjs` — copia del contenido de `tuyaClient.mjs` con **un solo import ajustado**:
  - `logger` import: `'./src/logging/logger.mjs'` → `'../../logging/logger.mjs'`

## Archivos a modificar (imports + lint + backup)

| Archivo | Línea | Cambio |
|---------|-------|--------|
| `server.mjs` | 16 | `'./tuyaClient.mjs'` → `'./src/api/tuya/client.mjs'` |
| `consumptionManager.mjs` | 5 | `'./tuyaClient.mjs'` → `'./src/api/tuya/client.mjs'` |
| `src/managers/weather.mjs` | 7 | `'../../tuyaClient.mjs'` → `'../../api/tuya/client.mjs'` (mismo número de `../`) |
| `eslint.config.mjs` | 26 | `'tuyaClient.mjs'` → `'src/api/tuya/client.mjs'` |
| `scripts/backup.sh` | 20 | `"tuyaClient.mjs"` → `"src/api/tuya/client.mjs"` |

## Archivos a eliminar

- `tuyaClient.mjs` (raíz)

## Comportamiento

Sin cambios:

- Mismas firmas de los 9 exports.
- Mismo cache de token (TTL basado en `expire_time - 60` segundos).
- Misma deduplicación de llamadas concurrentes al endpoint de token (vía `tokenPromise`).
- Misma firma HMAC-SHA256 V2 (header `sign_method: HMAC-SHA256`, headers vacíos en `stringToSign`).
- Mismo orden de búsqueda en `detectUid` (primeros 3 IDs).
- Misma prioridad en `getTodosDispositivos` (con UID usa `/users/{uid}/devices`; sin UID usa `/iot-03/devices` con `page_no=1, page_size=100`).
- Misma lógica de `alternar` (lee `Interruptor` de la config del dispositivo si existe, fallback a `switch_1`).

## Verificación

1. `grep -rn "tuyaClient" --include="*.mjs" --include="*.js" --include="*.sh"` debe devolver **cero** matches en archivos de código. La única ocurrencia legítima esperada es `server.mjs:505` (línea **comentada** con `//` al inicio — un grep con `--include="*.mjs"` la encuentra, pero se acepta como histórica). Verificación adicional: confirmar que esa línea empieza con `//`.
2. `npm test` debe pasar las 6 suites igual que antes (ninguna ejercita tuyaClient directamente — cobertura sintáctica + smoke).
3. `node server.mjs` debe arrancar sin `MODULE_NOT_FOUND`. El `initTuya()` se llama en algún punto del startup; la primera llamada real a la API Tuya puede fallar por credenciales inválidas o por falta de UID — eso es comportamiento conocido y ACEPTABLE para esta verificación. Lo que importa es que el módulo se carga y los exports existen.

## Fuera de alcance (explícito)

- **Inyección de dependencias** (`setDependencies({ axios })`): no se hace aquí. Si surge la necesidad de mockear HTTP para tests, será un spec aparte.
- **Tests dedicados** para `client.mjs`: paridad con las 3 fases previas.
- **Cambio en la firma de ningún export**: se mantienen las 9 funciones tal cual.
- **Cambio en el comportamiento del cache de token**: la deduplicación y TTL siguen igual.
- **Migrar `consumptionManager.mjs`**: sigue en la raíz. El path `'./src/api/tuya/client.mjs'` desde la raíz es válido y se ajustará cuando consumptionManager se mueva (en su propio spec).
- **Renombrar la constante `API_PATHS`**: no aporta valor, queda como está.

## Riesgos

- **Imports internos rotos al mover** (3er caso de esto, ya documentado en progress.md): si el plan no recalcula `'./src/logging/logger.mjs'` al mover de raíz a `src/api/tuya/`, el archivo falla al cargarse. Lección consolidada: el brief de Task 1 muestra el import YA corregido desde el principio, y Task 1 Step 3 hace un load-time test que lo verifica antes de commit.
- **`consumptionManager.mjs` aún en la raíz**: su import `'./src/api/tuya/client.mjs'` es relativo a la raíz, no a `src/`. Correcto — no hay que ajustar nada en consumptionManager más allá del path. Riesgo bajo.
- **`weather.mjs` ya migrado a `src/managers/`**: su import cambia de `'../../tuyaClient.mjs'` (tres segmentos: `../../` + `tuyaClient.mjs`) a `'../../api/tuya/client.mjs'` (cinco segmentos: `../../` + `api/tuya/client.mjs`). El número de `../` no cambia; es solo agregar `/api/tuya/` en el medio. Riesgo bajo, pero el plan debe verificar el diff exacto en Task 5.
- **Línea comentada en `server.mjs:505`**: queda como referencia histórica. El grep amplio la captura, pero no es un import activo. Aceptable; se documenta en Verificación #1.
- **Backup script desactualizado**: ya vimos en las fases tariff y weather que `scripts/backup.sh` queda stale si no se actualiza. Lo añadimos a Task 6.
