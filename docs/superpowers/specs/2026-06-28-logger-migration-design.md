# Diseño: Migración de `logger.mjs` a `src/logging/logger.mjs`

## Resumen

Mover el módulo `logger.mjs` desde la raíz del proyecto a `src/logging/logger.mjs` como parte de la migración incremental a `src/` (ver `project-progress`). El cambio es **1:1**: misma API pública, mismo comportamiento, mismos destinos de log. Solo se ajusta la resolución de la ruta de `logs/` para que siga apuntando a la raíz del proyecto después del movimiento.

## Contexto

`logger.mjs` exporta un singleton de `pino` con dos destinos:

- `pino/file` → `logs/server.log` (siempre activo, append, `mkdir: true`)
- `pino-pretty` → stdout (solo cuando `NODE_ENV !== 'production'`)

Resuelve `logDir` con `path.join(__dirname, 'logs')`, donde `__dirname` se calcula desde `import.meta.url`. Si se mueve el archivo a `src/logging/`, esa resolución apuntaría a `src/logging/logs/` en lugar de la raíz. Este spec resuelve ese detalle sin cambiar nada más.

El módulo es importado por 8 archivos, todos en la raíz:

- `server.mjs`, `config.mjs`, `tuyaClient.mjs`, `consumptionManager.mjs`, `tariffManager.mjs`, `weatherManager.mjs`, `alertManager.mjs`, `retentionManager.mjs`

`src/api/middleware/session.mjs` recibe el logger indirectamente, vía el callback `onWarn` que `server.mjs:203` le inyecta (`onWarn: (msg) => logger.warn(msg)`). **No** importa `logger.mjs` directamente — ese patrón se mantiene tal cual y no requiere cambio.

API usada por todos los consumidores: `logger.info(...)`, `logger.warn(...)`, `logger.error(...)`. Solo el endpoint `GET /log/:lin` de `server.mjs:719` usa el named export `logger.logFile`.

## Decisiones de diseño

- **Mover el archivo, no duplicarlo**: el viejo `logger.mjs` en raíz se borra tras actualizar los imports. No hay período de coexistencia.
- **`logs/` se queda en la raíz del proyecto**: el nuevo `logger.mjs` calcula `projectRoot` subiendo dos niveles desde `import.meta.url` (`src/logging/` → `src/` → raíz). Esto preserva la ruta absoluta esperada por el endpoint `GET /log/:lin` y por cualquier herramienta externa (operador, `tail`, etc.).
- **API pública intacta**: `export default logger` y `export { logFile }`. Sin factory, sin DI, sin cambios.
- **Imports como `node:fs` y `node:path`**: convención ES modules moderna para dependencias built-in. Mismo comportamiento, solo cambia el prefijo.
- **Sin tests nuevos**: el comportamiento queda cubierto indirectamente por los 6 tests existentes (`npm test`), todos importan módulos que importan el logger. Una regresión en la carga del módulo se manifestaría en el arranque del test runner.

## Archivos a crear

- `src/logging/logger.mjs` — copia adaptada del archivo actual.

## Archivos a modificar

### `src/logging/logger.mjs` (nuevo)

```js
import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function resolveProjectRoot(importMetaUrl) {
    const here = path.dirname(fileURLToPath(importMetaUrl));
    return path.resolve(here, '..', '..');
}

const projectRoot = resolveProjectRoot(import.meta.url);
const logDir = path.join(projectRoot, 'logs');
const logFile = path.join(logDir, 'server.log');

fs.mkdirSync(logDir, { recursive: true });

const isDev = process.env.NODE_ENV !== 'production';

const targets = [
    {
        target: 'pino/file',
        options: { destination: logFile, append: true, mkdir: true },
        level: process.env.LOG_LEVEL || 'info'
    }
];

if (isDev) {
    targets.push({
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'yyyy-mm-dd HH:MM:ss',
            ignore: 'pid,hostname'
        },
        level: process.env.LOG_LEVEL || 'info'
    });
}

const transport = pino.transport({ targets });
const logger = pino({ level: process.env.LOG_LEVEL || 'info' }, transport);

export default logger;
export { logFile };
```

### Imports a actualizar (8 archivos)

Reemplazar `from './logger.mjs'` por `from './src/logging/logger.mjs'`:

- `server.mjs:14`
- `config.mjs:5`
- `tuyaClient.mjs:3`
- `consumptionManager.mjs:4`
- `tariffManager.mjs:4`
- `weatherManager.mjs:6`
- `alertManager.mjs:3`
- `retentionManager.mjs:8`

`src/api/middleware/session.mjs` **no se toca** (no importa el logger, recibe `onWarn` por inyección).

## Archivos a eliminar

- `logger.mjs` (raíz)

## Comportamiento

Sin cambios:

- Mismas variables de entorno (`LOG_LEVEL`, `NODE_ENV`).
- Mismo formato JSON en disco, mismo formato pretty en stdout.
- Misma ruta `logs/server.log` en la raíz del proyecto.
- Misma API pública (`logger.info/warn/error`, `logFile`).
- Mismo fallo duro si no se puede crear `logs/`.

## Verificación

Tras la migración:

1. `npm test` debe pasar igual que antes (6 suites verdes).
2. `node server.mjs` debe arrancar sin errores y emitir la línea `[Server] listening on …` tanto a `logs/server.log` como a stdout (en dev).
3. `tail -f logs/server.log` debe seguir recibiendo entradas idénticas en formato.
4. `curl http://localhost:3000/log/0` debe devolver las últimas líneas del log sin cambios.

## Fuera de alcance (explícito)

- **Rotación de `logs/server.log`**: hoy no existe (verificado: ni `pino-roll` en deps, ni logrotate, ni script externo; `retentionManager.mjs` solo opera sobre `public/json/`). Queda como mejora futura en una sesión separada. Pregunta abierta para esa futura sesión: ¿se reutiliza `GENERAL.Retencion` (que ya parsea `15D/2M/1A`) o se introduce una política nueva?
- **Factory testeable** (`createLogger`) para mockear consumidores: misma razón.
- **Tests dedicados** para `logger.mjs`: cobertura indirecta vía `npm test`.
- **Cambio en la API de pino** (e.g. añadir `redact`, child loggers por módulo, etc.): mismo logger, mismo uso.

## Riesgos

- **Resolución de la raíz frágil**: si en el futuro alguien mueve el archivo a otra profundidad distinta a `src/logging/`, `path.resolve(here, '..', '..')` habrá que ajustarlo. Documentado en el comentario del propio archivo. Aceptable.
- **`fs.mkdirSync` al cargar el módulo**: si el módulo se carga desde un test o un script auxiliar, intentará crear `logs/`. Ya pasa hoy con el archivo en raíz; no es regresión. Aceptable.