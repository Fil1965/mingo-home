# Diseño: Migración de `weatherManager.mjs` a `src/managers/weather.mjs`

## Resumen

Mover y renombrar `weatherManager.mjs` desde la raíz a `src/managers/weather.mjs`. Misma API pública (`fetchWeather`, `actualizarTiempo`), mismo comportamiento, mismas rutas de salida (`<state.dirname>/public/json/`). El archivo recibe `dirname` a través de `state.dirname` (no usa `__dirname`), así que la ruta de salida se conserva automáticamente.

**Lección del spec del tariff aplicada**: el archivo tiene dos imports relativos internos (`./src/logging/logger.mjs` y `./tuyaClient.mjs`) que hay que recalcular al cambiar de directorio. El plan los ajustará desde el inicio, no a posteriori.

## Contexto

`weatherManager.mjs` implementa la lógica de obtención de datos meteorológicos con fallback entre AEMET y OpenWeather, además de agregar datos de sensores locales (temperatura/humedad) desde dispositivos Tuya.

Funciones exportadas:
- `fetchWeather(state)` — entry point. Usa `state.instalacion`, `state.dirname`, `state.uid`. Devuelve `true`/`false`.
- `actualizarTiempo(tiempo, dirname)` — persiste el resultado en `<dirname>/public/json/<YYYY-MM-DD>_tiempo.json`.

Funciones internas (no exportadas): `fetchOpenWeather`, `getDistance` (haversine), `fetchAemet` (con reintentos), `findNearestStation` (con cache), `getLocalSensorsData`.

Dependencias externas (en orden de aparición):
- `fs/promises`, `fs` (named `existsSync`), `path`, `moment`, `axios` — built-ins y paquetes npm; sin cambios.
- `logger` — ya migrado a `src/logging/logger.mjs` (sesión previa).
- `getTodosDispositivos` desde `tuyaClient.mjs` — sigue en la raíz.

## Consumidores

Cinco archivos importan desde `weatherManager.mjs`:

- `server.mjs:18` — `fetchWeather` (único consumidor de producción).
- `test/test_weather.mjs:1` — `fetchWeather` (test, path relativo `../weatherManager.mjs` desde `test/`). **NO se ejecuta en `npm test`** pero lo actualizamos para no dejar import zombie.
- `test/verify_cache.mjs:1` — `fetchWeather` (script auxiliar de verificación de cache).
- `test/verify_ttl.mjs:1` — `fetchWeather` (script auxiliar de verificación TTL).

Adicionalmente:
- `eslint.config.mjs:26` enumera `weatherManager.mjs` en la lista de files del lint.
- `scripts/backup.sh:18` lista `"tariffManager.mjs"` y `"weatherManager.mjs"` en el array FILES. Ya actualizamos `tariffManager.mjs` → `src/managers/tariff.mjs` en la fase anterior (commit `7e9271f`). Falta `weatherManager.mjs`.

## Decisiones de diseño

- **Mover y renombrar** simultáneamente: `weatherManager.mjs` → `src/managers/weather.mjs`. Coherente con `logger.mjs` y `tariff.mjs` (sin sufijo). El sufijo `Manager` no aporta información cuando el archivo ya vive en `src/managers/`.
- **Firma de `fetchWeather(state)` y `actualizarTiempo(tiempo, dirname)` se conserva**: el módulo sigue recibiendo `dirname` a través de `state.dirname` y como parámetro explícito. No se introduce `import.meta.url`. Las rutas de salida siguen calculándose relativas al `dirname` recibido, así que `<raíz>/public/json/...` se conserva.
- **Imports internos recalculados desde el inicio** (lección del spec del tariff):
  - `'./src/logging/logger.mjs'` → `'../logging/logger.mjs'`
  - `'./tuyaClient.mjs'` → `'../tuyaClient.mjs'` (tuyaClient sigue en la raíz por ahora; cuando se migre, este path se ajustará en ese spec)
- **API pública intacta**: los dos exports mantienen nombre y firma.
- **Comportamiento idéntico**: ningún cambio funcional.
- **Tests auxiliares actualizados**: `verify_cache.mjs` y `verify_ttl.mjs` no están en `npm test` pero importan `weatherManager`. Si los dejamos con el path antiguo y alguien los corre, fallan con `MODULE_NOT_FOUND`. Actualizamos los imports por higiene.
- **Verificación con grep amplio** (lección del logger): el plan debe buscar `weatherManager` por todo el árbol, no solo `'./weatherManager.mjs'`.

## Archivos a crear

- `src/managers/weather.mjs` — copia del contenido de `weatherManager.mjs` con los imports internos recalculados:
  - `'./src/logging/logger.mjs'` → `'../logging/logger.mjs'`
  - `'./tuyaClient.mjs'` → `'../tuyaClient.mjs'`

## Archivos a modificar (imports + lint + backup)

| Archivo | Línea | Cambio |
|---------|-------|--------|
| `server.mjs` | 18 | `'./weatherManager.mjs'` → `'./src/managers/weather.mjs'` |
| `test/test_weather.mjs` | 1 | `'../weatherManager.mjs'` → `'../src/managers/weather.mjs'` |
| `test/verify_cache.mjs` | 1 | `'../weatherManager.mjs'` → `'../src/managers/weather.mjs'` |
| `test/verify_ttl.mjs` | 1 | `'../weatherManager.mjs'` → `'../src/managers/weather.mjs'` |
| `eslint.config.mjs` | 26 | `'weatherManager.mjs'` → `'src/managers/weather.mjs'` (lista de files del lint) |
| `scripts/backup.sh` | 18 | `"weatherManager.mjs"` → `"src/managers/weather.mjs"` (array FILES) |

## Archivos a eliminar

- `weatherManager.mjs` (raíz)

## Comportamiento

Sin cambios:

- Misma firma de las dos funciones exportadas.
- Mismas rutas de salida `<raíz>/public/json/YYYY-MM-DD_tiempo.json` y `<raíz>/public/json/aemet_station_cache.json`.
- Mismo manejo de errores en `fetchAemet`, `fetchOpenWeather`, `actualizarTiempo`, `getLocalSensorsData`.
- Misma lógica de prioridad AEMET/OpenWeather según `GENERAL.PrioridadTiempo`.
- Misma lógica de cache de estación AEMET (TTL 24h, fallback a cache expirada en 429).
- Mismo formato del JSON de tiempo (mapa de 24 horas con claves "00"–"23").

## Verificación

1. `grep -rn "weatherManager" --include="*.mjs" --include="*.js" --include="*.sh"` debe devolver **cero** matches en archivos de código. Las únicas ocurrencias legítimas son `docs/superpowers/specs/2026-06-28-weather-migration-design.md` (este spec) y los notes de progreso en `.superpowers/sdd/`.
2. `npm test` debe pasar las 6 suites igual que antes (ninguna ejercita weather directamente; es cobertura sintáctica + smoke).
3. `node server.mjs` debe arrancar, ejecutar `fetchWeather` en background y dejar un fichero `public/json/<YYYY-MM-DD>_tiempo.json` actualizado o un error gracioso (AEMET 401/429, OpenWeather 401, etc.) — la salida JSON no es crítica para verificar el import.

## Fuera de alcance (explícito)

- **Inyección de dependencias** (`setDependencies` al estilo de `consumptionManager`): no se hace aquí.
- **Tests dedicados** para `weather.mjs`: `test_weather.mjs` existe pero no está en `npm test`; moverlo al script de tests es un cambio independiente.
- **Mover `findNearestStation` a un archivo propio**: refactor mayor; no se hace aquí.
- **Cambio en la firma de `fetchWeather`**: se mantiene `(state)`.
- **Migrar `tuyaClient.mjs`**: sigue en la raíz. El path `'../tuyaClient.mjs'` desde `src/managers/weather.mjs` se ajustará cuando `tuyaClient` se mueva.

## Riesgos

- **Imports internos rotos al mover**: si el plan no recalcula `'./src/logging/logger.mjs'` y `'./tuyaClient.mjs'`, el archivo falla al cargarse. Lección del spec del tariff: el brief de Task 1 debe mostrar los imports YA corregidos desde el principio, no como hotfix posterior.
- **Tests auxiliares (`verify_cache.mjs`, `verify_ttl.ms`) no se ejecutan en CI**: si los dejamos sin migrar, no fallan en `npm test` pero sí cuando alguien los corre localmente. Riesgo bajo, costo de migrarlos trivial.
- **Plan con grep estrecho**: si el grep solo busca `'./weatherManager.mjs'`, se nos puede pasar `'../weatherManager.mjs'` en `test/`. El spec del logger tuvo este gap; este plan usa grep amplio desde el inicio.
- **Backup script desactualizado**: ya vimos en la fase del tariff que `scripts/backup.sh` queda stale si no se actualiza. Lo añadimos a la lista de cambios de este spec.