# Copilot / Agent Instructions for the Tuya repo

Short, actionable guidance for an AI coding agent to be productive in this codebase.

## TL;DR
- **Run**: `node server.mjs` (avoid `server.js` if present).
- **Config**: `instalacion.ini` is the single source of truth.
- **Architecture**: Node.js + Express (Server) + jQuery/Bootstrap (Client).
- **Core Principle**: **BATCH REQUESTS**. Do not make individual API calls to Tuya if you can avoid it. Use `getTodosDispositivos`.

## Big-picture architecture
- **Server**: `server.mjs` is the entry point. It handles:
  - Static file serving (`public/`).
  - API routes (`/estados`, `/alternar`, etc.).
  - Background tasks ( Consumption & Tariff).
- **Tuya Integration**: `tuyaClient.mjs` handles raw API calls using Tuya V2 signature logic.
  - **Critical**: Use `getTodosDispositivos(uid)` for bulk status to avoid rate limits.
  - **Signature**: `calculateSign` uses `clientId + (accessToken || '') + t + stringToSign`.
  - **Token Safety**: Uses a `tokenPromise` lock to prevent concurrent token requests on startup.
  - `state.uid` is detected via `detectUid` at startup and cached in `state.uid`.
- **Background Tasks**:
  - `tariffManager.refrescarTarifa`: Downloads hourly prices -> `public/json/YYYY-MM-DD_rede.json`.
  - `weatherManager.fetchWeather`: Fetches AEMET data. Uses `fetchAemet` helper (3 attempts, exponential backoff, 20s timeout).
  - **Weather Failure**: If AEMET fails, it retries for 5 minutes. If it still fails, it checks for `OpenWeatherApiKey` as a fallback.
  - **Weather Priority**: Configurable via `PrioridadTiempo` (e.g., `OpenWeather, AEMET`). Default is `AEMET, OpenWeather`.
  - `consumptionManager.checkConsumption`: Runs every minute. **MUST USE BATCH FETCHING**.
- **Authentication**: Custom session-based auth (`express-session` + `session-file-store`). **Not** Basic Auth (though a middleware exists, it's unused). Users are defined in `instalacion.ini` [USUARIOS].
- **Scheduling**: The `Horas` parameter in device sections acts as a "valid window" for both tariff-based charging and humidity-based control. If outside `Horas`, the device is forced OFF if it was ON.

## Important runtime/config patterns
- **`instalacion.ini` Sections**:
  - `[GENERAL]`: Global settings (`ConsumoMaximo`, `Titulo`, `Coordenadas`, `AEMETApiKey`, `AEMETEstacion`, `OpenWeatherApiKey`, `PrioridadTiempo`, `CarpetaJson`).
  - `[SERVER]`: Network config (`Port`, `Host`, `SessionSecret`).
  - `[TUYA]`: Credentials (`baseUrl`, `imagesUrl`, `accessKey`, `secretKey`).
  - `[USUARIOS]`: `username=password` pairs.
  - `[N]`: Device sections (numeric ID).
- **Device Properties**:
  - `Id`: Tuya Device ID.
  - `Interruptor`: Switch code (default `switch_1`).
  - `Apagable`: `Si`/`No` (sheddable load).
  - `Carga`: Number of cheapest hours to try to run (used with tariff logic).
  - `Horas`: Schedule for operation (commas or ranges, e.g., `20-8`).
  - `Humedad_Maxima` + `Higrometro`: Automation rule. Turns ON if humidity > Max, OFF if < Max (inverted logic vs dehumidifier standard, check `consumptionManager`).
- **Data Persistence**:
  - JSON files in `public/json/` are the historical record (prices, weather).
  - `public/json/aemet_station_cache.json` stores the nearest weather station ID with a 24h TTL.
  - `user_prefs/` stores UI preferences.

## API & Performance Best Practices
1.  **Batching is Mandatory**:
    - **Frontend**: `refrescar_dispositivos` calls `GET /estados` (returns cached/batched status of ALL devices). **Never** loop `GET /estado/:id`.
    - **Backend**: `checkConsumption` calls `getTodosDispositivos` once per cycle. **Never** loop `getEstado(id)`.
2.  **Solidity**:
    - Background tasks must handle network failures gracefully without crashing.
    - **Startup**: Initial tasks (AEMET, checkConsumption) are backgrounded via `detectAndInit` in `server.mjs` using `setTimeout(..., 0)` to ensure the server mounts instantly.
    - Avoid overlapping execution of background tasks.

## Routes Quick Reference
- `GET /estados`: Returns JSON with status of all configured devices.
- `GET /alternar/:id/:est`: Toggles device (0/1).
- `GET /instalacion.json`: Returns safe subset of config.
- `POST /config/valor`: Updates specific config values hot. Supports deleting values by sending empty string. Sections `GENERAL` (specific keys), `SERVER`, `TUYA`, and `USUARIOS` are fully editable.
- `POST /config/dispositivo/add`: Adds a new device with auto-detection of capabilities.
- `POST /config/dispositivo/eliminar`: Removes a device from configuration.
- `POST /config/usuario/añadir`: Adds a new user to `[USUARIOS]`.
- `POST /config/usuario/eliminar`: Removes a user.
- `GET /tuya/info/:deviceId`: Gets raw cloud info for a device.
- `GET /tuya/todos`: Discovers all devices in the Tuya account.

## Development & Debugging
- **Run**: `node server.mjs`.
- **Logs**: Standard stdout. The web UI log viewer pipes `journalctl`.
- **Diagnostics**: `consumptionManager` logs IDs returned by the cloud when a device status is missing.
- **Tuya UID**: Explicitly detected at startup via `detectUid` (probing first few device IDs).

---
**When editing**:
- Prefer `checkConsumption` logic updates to be batched.
- Keep `instalacion.ini` as the master config.
- Ensure new endpoints are protected with `requireAuth`.