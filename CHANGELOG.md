# Changelog

Todas las modificaciones notables de este proyecto se documentarán en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/lang/es/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- `consumptionManager.checkConsumption`: tres bucles `Object.keys(...).forEach(async key => …)` no esperaban a las llamadas `alternar()`, lo que hacía que las acciones sobre los dispositivos se dispararan en paralelo y en orden no determinista, y que `setInterval` solapara ejecuciones. Reemplazados por `for (const key of Object.keys(...))` para garantizar ejecución secuencial y espera completa antes de retornar. `return` dentro de `forEach` cambiados a `continue` para preservar la semántica.

### Added
- `consumptionManager.setDependencies(deps)`: punto de inyección de dependencias opcional para tests. En producción no tiene efecto (los wrappers `_alternar`, `_getTodosDispositivos`, `_actualizarConsumo`, `_refrescarTarifa` caen a los imports originales si `_deps` es `null`).
- `test/test_check_awaits.mjs`: test que verifica que `checkConsumption` espera a todas las llamadas `alternar()` antes de retornar y que las ejecuta en orden determinista. Detecta regresiones del bug del `forEach(async)`.

### Added
- `src/api/middleware/auth.mjs`: middleware `requireAdmin` + util `getAdminList`. Primera incursión en estructura `src/api/`; la reorganización completa se completará en una fase posterior.
- `test/test_require_admin.mjs`: 11 tests unitarios para el middleware (admin pasa, no-admin recibe 403, sin sesión recibe 401, lista reevaluada por request, etc.).
- `src/api/middleware/session.mjs`: factoría `buildSessionOptions({ secret, isProduction, maxAgeMs?, cookiePath? })` que aplica defaults endurecidos (`httpOnly`, `sameSite=lax`, `secure` en producción, `maxAge` 24 h, `path=/`) y rechaza secretos inseguros en producción. Reemplaza el objeto literal duplicado en `server.mjs`.
- `src/api/middleware/cors.mjs`: middleware CORS restrictivo con allowlist configurable vía `SERVER.CorsOrigins`. Política por defecto: NO se emite `Access-Control-Allow-Origin` (el navegador bloquea cualquier cross-origin). Soporta `OPTIONS` preflight, wildcards explícitos `["*"]` y emite `Vary: Origin` para caches.
- `src/config/persistence.mjs`: helper `saveAtomic(filePath, data, options?)` para escritura atómica de JSON. Escribe a `*.tmp`, hace `rename` y opcionalmente conserva hasta N backups con timestamp + secuencia + random en un directorio configurable. Usado por `config.mjs` para `instalacion.json`.
- `test/test_session.mjs`: tests para `buildSessionOptions` (defaults endurecidos, rechazo del secreto por defecto en producción, aceptación en desarrollo, `maxAge` y `cookiePath` personalizables).
- `test/test_cors.mjs`: tests para el middleware CORS (sin origins no se emite header, origin permitido pasa, OPTIONS preflight, wildcards, `Vary: Origin`).
- `test/test_save_atomic.mjs`: tests para `saveAtomic` (escritura sin archivos `.tmp` huérfanos, backups con secuencia monotónica, truncado a `maxBackups`, comportamiento cuando no existe archivo previo, errores de escritura no dejan basura).

### Changed
- `package.json`: `npm test` ejecuta también `test/test_check_awaits.mjs`, `test/test_require_admin.mjs`, `test/test_session.mjs`, `test/test_cors.mjs` y `test/test_save_atomic.mjs`.
- `server.mjs`: extraído el middleware `requireAdmin` para eliminar el patrón duplicado "split + includes + 403" en 9 endpoints. Creado `src/api/middleware/auth.mjs` con `createRequireAdmin(getInstalacion)` (factoría que evalúa la lista de admins en cada request) y `getAdminList(instalacion)` (util compartido). Endpoints con gate estricto ahora declaran la cadena `requireAuth, requireAdmin`; los que necesitan el flag sin abortar (`/instalacion.json`, `/session`, `/alerts*`) usan `getAdminList(state.instalacion)` directamente.
- `server.mjs`: sesión configurada vía `buildSessionOptions({ secret, isProduction: NODE_ENV === 'production' })`. En producción, un secret igual al default `'cambiar-esta-clave'` (o ausente) hace que el servidor **no arranque**; se exige `SERVER.SessionSecret` o la variable de entorno `SESSION_SECRET`.
- `server.mjs`: CORS por defecto deshabilitado (no se emite `Access-Control-Allow-Origin`). Si `instalacion.json` define `SERVER.CorsOrigins` (array JSON o string CSV), se aplica allowlist. Eliminado `app.use(cors())` y `corsOptionsDelegate`.
- `config.mjs`: persistencia de `instalacion.json` vía `saveAtomic()`; cada guardado genera un backup en `instalacion.backups/instalacion.json.backup-<timestamp>-<seq>-<rand>` (máx. 10, los más antiguos se eliminan automáticamente).
- `sync.config.json`: añadido `instalacion.backups/` a los excludes para que los backups locales no se sincronicen al servidor de producción.

## [1.1.1] - 2026-06-27

### Added
- Script `npm run sync` para copiar solo los archivos necesarios del entorno de desarrollo al servidor de producción. Ver `scripts/sync.mjs` y `sync.config.json`.
- Tests para el script de sincronización en `test/test_sync.mjs`.
- Endpoint público `GET /version` que devuelve la versión declarada en `package.json`.
- `loadVersion()` en `public/js/ui/dashboard.mjs` muestra la versión de la aplicación en el encabezado (al lado del título "MingoHome").
- Documentos de diseño y plan de implementación en `docs/superpowers/specs/2026-06-27-deployment-sync-design.md` y `docs/superpowers/plans/2026-06-27-deployment-sync-plan.md`.

### Fixed
- El clic en la tarjeta de un dispositivo en la UI ahora usa `GET /alternar/:id/:est` en lugar de `POST`, resolviendo el error "Error desconocido o dispositivo offline".
- `scripts/sync.mjs`: el filtro aplica las exclusiones antes de cualquier `stat`, protege frente a errores de `stat` y omite archivos sin cambios cuando el destino ya tiene el mismo tamaño y un `mtime` igual o posterior al de la fuente.
- Mensajes de error en `config.mjs` y `server.mjs` muestran la ruta del fichero y el mensaje de error para facilitar el diagnóstico.

### Changed
- `public/js/utils/safe-dom.mjs`: `raw()` ahora tolera valores `null`/`undefined` sin lanzar excepciones.
- `public/js/ui/config.mjs`: el encabezado de las secciones de configuración se renderiza como HTML confiable mediante `raw()`.
- Las referencias de configuración pasan de `instalacion.ini` a `instalacion.json` en `CLAUDE.md`, `README.md` y `.github/copilot-instructions.md`.
- `sync.config.json`: la ruta de destino por defecto apunta a `N:\home\philippe\node.js\tuya` (antes `tuya.1.1.0`).
- `eslint` actualizado a la versión `10.6.0`.

### Security
- Eliminada la dependencia `@tuya/tuya-connector-nodejs` del `package.json`. El código ya usaba `axios` directamente en `tuyaClient.mjs`, por lo que el paquete era innecesario y arrastraba una versión vulnerable de `axios` (`0.21.4`).
- Eliminada la dependencia `npm` del `package.json`. Era una dependencia de herramienta CLI innecesaria en producción y arrastraba `undici` vulnerable.

## [1.1.0] - 2026-06-27

### Added
- Sistema integral de domótica y eficiencia energética MingoHome.
- Servidor Express en `server.mjs` con API REST, sesiones, tareas en segundo plano y frontend estático.
- Integración con Tuya Cloud mediante firmas V2 en `tuyaClient.mjs`.
- Gestores de tarifas (`tariffManager.mjs`), meteorología (`weatherManager.mjs`), consumo (`consumptionManager.mjs`) y alertas (`alertManager.mjs`).
- Paneles ESP32 MingoTouch con endpoints `/esp32` y `/mingotouchs/*`.
