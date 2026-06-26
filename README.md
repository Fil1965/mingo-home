# Tuya — Automatización doméstica ⚡️

[![Node.js CI](https://github.com/<OWNER>/<REPO>/actions/workflows/nodejs-test.yml/badge.svg)](https://github.com/<OWNER>/<REPO>/actions/workflows/nodejs-test.yml)

Pequeño proyecto para control y optimización de consumo con dispositivos Tuya.

## 🧰 Scripts
- `npm start` — arranca el servidor (aunque `package.json` apunta a `server.js`; en local preferible `node server.mjs`).
- `npm test` — ejecuta la suite de tests (test/test_horas.mjs).

## ⚙️ Parámetros relevantes en `instalacion.ini`
- `Carga = n` → encender dispositivo durante las `n` horas más baratas del día.
- `Horas` → limita las horas sobre las que se seleccionan las `n` horas más baratas. Admite:
  - Lista: `Horas = 8,9,10`
  - Rango inclusive con wrap-around: `Horas = 20-6`
- `Humedad_Maxima` + `Higrometro` → control por humedad.
- `Humedad_Horas` → horas en las que se permite actuar por humedad. Mismo formato que `Horas`. Si no se especifica, se asume 24 horas.

## ✅ CI
Añadido workflow `nodejs-test.yml` que se ejecuta en `push` y `pull_request` sobre `main`/`master`. Recomendado: reemplazar `<OWNER>/<REPO>` en el badge por tu usuario y repo para que muestre el estado real.

---

Si quieres, puedo: ✅ actualizar el badge con el repo real si me das el `owner/repo`, ✅ añadir más tests, o ✅ mejorar la documentación del `instalacion.ini` con ejemplos reales.