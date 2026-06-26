# MingoHome — Sistema integral de domótica y eficiencia energética ⚡️

[![Node.js CI](https://github.com/Fil1965/mingo-home/actions/workflows/nodejs-test.yml/badge.svg)](https://github.com/Fil1965/mingo-home/actions/workflows/nodejs-test.yml)
[![License](https://img.shields.io/badge/license-UNLICENSED-red)](./LICENSE)

Sistema integral de domótica y eficiencia energética para el control inteligente del hogar y dispositivos MingoTouch.

Integra dispositivos Tuya con tarifas eléctricas PVPC, datos meteorológicos (AEMET/OpenWeather) y paneles ESP32 MingoTouch para automatizar el encendido/apagado de cargas en las horas más baratas.

## 🚀 Inicio rápido

```bash
npm install
npm start          # arranca el servidor (node server.mjs)
```

El servidor escucha por defecto en `http://0.0.0.0:3000`.

### Configuración

La configuración se almacena en `instalacion.json` (generado a partir del antiguo `instalacion.ini`). Antes de arrancar por primera vez, copia la plantilla y edita los valores:

```bash
cp instalacion.example.json instalacion.json
# edita instalacion.json con tus credenciales de Tuya, usuarios, etc.
```

> ⚠️ `instalacion.json` está excluido del repositorio (`.gitignore`) porque contiene credenciales y contraseñas.

## 🧰 Scripts

| Comando | Descripción |
|---------|-------------|
| `npm start` | Arranca el servidor (`node server.mjs`) |
| `npm test` | Ejecuta la suite de tests (`test/test_horas.mjs`) |
| `npm run lint` | Linting de archivos `.mjs` del frontend con ESLint |

## 🏗️ Arquitectura

```
server.mjs              → Entry point (Express)
config.mjs              → Carga/guarda configuración (instalacion.json)
tuyaClient.mjs          → API Tuya cloud (firmas V2, batch requests)
tariffManager.mjs       → Descarga precios PVPC por hora
weatherManager.mjs      → Datos meteorológicos AEMET/OpenWeather
consumptionManager.mjs  → Lógica de consumo y scheduling de dispositivos
alertManager.mjs        → Alertas de la interfaz
retentionManager.mjs    → Limpieza de datos históricos
logger.mjs              → Logging estructurado (pino)
public/                 → Frontend estático (HTML/JS, jQuery, Bootstrap, Chart.js)
scripts/                → Scripts de utilidad (backup, iconos)
test/                   → Tests
```

## ⚙️ Parámetros de dispositivos

Cada dispositivo se define como una sección numerada en `instalacion.json` dentro de `Dispositivos`:

| Parámetro | Descripción |
|-----------|-------------|
| `Id` | Tuya Device ID |
| `Interruptor` | Código del switch (por defecto `switch_1`) |
| `Apagable` | `Si`/`No` — carga desconectable |
| `Carga` | Nº de horas más baratas del día para encender el dispositivo |
| `Horas` | Ventana horaria válida. Admite lista (`8,9,10`) o rango con wrap-around (`20-6`) |
| `Humedad_Maxima` | Umbral de humedad para control automático |
| `Higrometro` | ID del sensor de humedad |
| `Humedad_Horas` | Horas en las que se permite actuar por humedad (mismo formato que `Horas`; por defecto 24h) |

### Ejemplo

```json
"Dispositivos": {
  "0": {
    "Id": "bfefe0c64f84c2f641rprm",
    "Descripcion": "Lavadora",
    "Interruptor": "switch_1",
    "Apagable": "Si",
    "Carga": 3,
    "Horas": "20-8"
  }
}
```

## 🔌 Endpoints principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/estados` | Estado bulk de todos los dispositivos (cacheado) |
| GET | `/alternar/:id/:est` | Enciende (1) / apaga (0) un dispositivo |
| GET | `/instalacion.json` | Configuración segura (sin credenciales) |
| POST | `/config/valor` | Actualiza un valor de configuración |
| POST | `/config/dispositivo/add` | Añade un dispositivo (auto-detección) |
| POST | `/config/dispositivo/eliminar` | Elimina un dispositivo |
| GET | `/weather/current` | Tiempo actual (cacheado) |
| GET | `/energy/status` | Consumo actual y nivel de precio |
| GET | `/esp32?esp32=<num>` | Lista de dispositivos asignados a un panel ESP32 |

## ✅ CI

El workflow `.github/workflows/nodejs-test.yml` ejecuta `npm test` automáticamente en cada `push` y `pull_request` sobre la rama `main`, probando Node.js 18.x y 20.x.

## 📄 Licencia

UNLICENSED — Uso privado. © Philippe Mingo.
