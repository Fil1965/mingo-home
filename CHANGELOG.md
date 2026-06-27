# Changelog

Todas las modificaciones notables de este proyecto se documentarán en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/lang/es/spec/v2.0.0.html).

## [Unreleased]

### Added
- Script `npm run sync` para copiar solo los archivos necesarios del entorno de desarrollo al servidor de producción. Ver `scripts/sync.mjs` y `sync.config.json`.
- Tests para el script de sincronización en `test/test_sync.mjs`.

### Fixed
- El clic en la tarjeta de un dispositivo en la UI ahora usa `GET /alternar/:id/:est` en lugar de `POST`, resolviendo el error "Error desconocido o dispositivo offline".

### Changed
- `public/js/utils/safe-dom.mjs`: `raw()` ahora tolera valores `null`/`undefined` sin lanzar excepciones.
- `public/js/ui/config.mjs`: el encabezado de las secciones de configuración se renderiza como HTML confiable mediante `raw()`.

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
