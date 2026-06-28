# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

- **Install dependencies**: `npm install`
- **Start the server**: `npm start` (runs `node server.mjs`)
- **Run the test suite**: `npm test` (executes `node test/test_horas.mjs`)
- **Run a single test file**: `node test/<test_file>.mjs`
- **Lint (if ESLint config exists)**: `npx eslint .` *(add a script in `package.json` if you want a shortcut)*
- **Sync to production**: `npm run sync` (copies only required files to the destination configured in `sync.config.json`)
- **Check repository status**: `git status`
- **View recent commits**: `git log -5 --oneline`

## High‑Level Architecture

- **Entry point**: `server.mjs` – an Express server that:
  - Serves static assets from `public/`
  - Exposes a JSON API used by the web UI and ESP32 panels
  - Manages sessions via `express-session` + `session-file-store`, configured through `buildSessionOptions` in `src/api/middleware/session.mjs` (hardened cookies, production‑only secret enforcement)
  - Starts background jobs for tariff refresh, weather fetching, and consumption checks
  - Applies a restrictive CORS policy (`createCorsMiddleware` in `src/api/middleware/cors.mjs`) — by default NO cross-origin is allowed
- **Tuya integration**: `tuyaClient.mjs` handles low‑level signed API calls to the Tuya cloud. The critical functions are `getTodosDispositivos` (bulk status) and `detectUid` (caches the UID).
- **Domain managers**:
  - `tariffManager.mjs` – downloads hourly electricity prices
  - `weatherManager.mjs` – pulls weather data from AEMET/OpenWeather
  - `consumptionManager.mjs` – evaluates device‑level consumption and applies scheduling logic. Supports `setDependencies(deps)` for test injection.
  - `alertManager.mjs` – stores and serves UI alerts
- **`src/` modules** (incremental migration; remaining root modules will follow in a later phase):
  - `src/api/middleware/auth.mjs` – `createRequireAdmin(getInstalacion)` middleware factory + `getAdminList(instalacion)` util
  - `src/api/middleware/session.mjs` – `buildSessionOptions({ secret, isProduction })` hardened cookie config
  - `src/api/middleware/cors.mjs` – `createCorsMiddleware(allowed)` restrictive CORS middleware
  - `src/config/persistence.mjs` – `saveAtomic(filePath, data, options?)` atomic write with optional rotating backups
- **Configuration**: Centralised in `instalacion.json`. Sections include:
  - `[GENERAL]` – global settings (max consumption, titles, API keys, admin list)
  - `[SERVER]` – host/port, session secret, **and `CorsOrigins`** (array of allowed origins; `["*"]` for wildcard)
  - `[TUYA]` – cloud credentials
  - `[USUARIOS]` – username/password pairs for UI login
  - `Dispositivos` with numeric sub‑keys (`[0]`, `[1]`, …) – individual device definitions (Tuya ID, scheduling, ESP32 mapping, etc.)
  - `instalacion.json` is persisted via `saveAtomic()` and automatically backed up to `instalacion.backups/` (max 10 rolling backups) on every save. The backup dir is excluded from `npm run sync`.
- **Frontend**: Static HTML/JS under `public/` uses jQuery, Bootstrap, Chart.js, and Moment.js to render device panels and charts.
- **ESP32 panels (MingoTouch)**: The `/esp32` and `/mingotouchs/*` endpoints provide per‑panel device lists, page ordering, theme selection, and timestamps. Configuration is persisted back into `instalacion.json`.

## Key Runtime Patterns

- **Batch requests are mandatory** – use `/estados` (or `getTodosDispositivos`) to fetch the status of *all* devices in a single call; avoid looping over `/estado/:id`.
- **Background tasks** run on a one‑minute interval (`checkConsumption`) and hourly for tariff/weather. They are started with `setTimeout(...,0)` to keep server start fast.
- **UID detection** is performed once at startup and cached in `state.uid` to avoid repeated discovery.
- **Config updates** are performed via the `/config/*` API; changes are saved immediately to `instalacion.json` via atomic write (with rolling backup).

## Important API Endpoints (quick reference)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/estados` | Bulk device status (cached) |
| GET | `/alternar/:id/:est` | Toggle a device on/off |
| GET | `/instalacion.json` | Safe subset of configuration |
| POST | `/config/valor` | Update a single config key (supports delete with empty string) |
| POST | `/config/dispositivo/add` | Add a new device (auto‑detect capabilities) |
| POST | `/config/dispositivo/eliminar` | Remove a device |
| POST | `/config/usuario/añadir` | Add UI user |
| POST | `/config/usuario/eliminar` | Remove UI user |
| GET | `/tuya/info/:deviceId` | Raw cloud info for a device |
| GET | `/tuya/todos` | Retrieve all devices from Tuya account |
| GET | `/esp32?esp32=<num>` | List devices assigned to a specific ESP32 panel |
| POST | `/mingotouchs/add` | Assign a device to a panel |
| POST | `/mingotouchs/remove` | Unassign a device |
| POST | `/mingotouchs/reorder` | Change page ordering for a panel |
| GET | `/weather/current` | Current weather data (cached JSON) |
| GET | `/energy/status` | Current power consumption and price level |

## Development Tips

- The project does **not** use a build step; all server code is native ES modules (`.mjs`).
- When adding new routes, protect them with the `requireAuth` middleware.
- Keep batch‑fetch logic in `consumptionManager` and `weatherManager`; avoid adding per‑device network calls.
- For any new configuration values, update `instalacion.json` and, if needed, expose them via `/config/valor`.
- For new admin‑gated routes, append `requireAdmin` after `requireAuth`. Use `createRequireAdmin(getInstalacion)` so the admin list is re‑evaluated every request (lets `/config/usuario/*` re‑permission dynamically).
- Logging is done via `console.log`. Use the UI’s log viewer (`/log/:lin`) for debugging.

---

*Generated by Claude Code*