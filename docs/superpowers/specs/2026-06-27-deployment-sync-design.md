# Diseño: Script de sincronización a producción (`npm run sync`)

## Resumen

Añadir un script invocable con `npm run sync` que copie desde el directorio de desarrollo hacia una carpeta de producción configurable solo los archivos necesarios para ejecutar el servidor.

## Contexto

El proyecto es un servidor Node.js/Express sin paso de build. Para desplegar en producción solo se necesita:

- Código del servidor (`server.mjs` y módulos asociados).
- Archivos estáticos del frontend (`public/`) excepto datos de runtime.
- `package.json` y `package-lock.json` para instalar dependencias.

No se deben copiar dependencias (`node_modules/`), datos históricos (`public/json/`), tests, archivos de configuración específicos del entorno (`instalacion.json`, `notifications.json`) ni sesiones/logs generados en runtime.

## Decisiones de diseño

- **Dependencias**: no se copia `node_modules/`. El despliegue final requiere ejecutar `npm install` en producción.
- **Configuración del destino**: mediante archivo `sync.config.json` en la raíz del proyecto.
- **Modo de copia**: solo copia/actualiza archivos existentes; **no elimina** archivos huérfanos del destino.
- **Preservación**: `instalacion.json` y `notifications.json` se preservan en destino si ya existen.
- **Implementación**: script Node.js `.mjs` multiplataforma usando `fs.cpSync` con filtro. Los patrones de exclusión soportan coincidencia exacta de nombre y comodines simples (`*` al final).

## Archivos a crear/modificar

- `scripts/sync.mjs` — script de sincronización.
- `sync.config.json` — configuración editable del destino y exclusiones.
- `package.json` — añadir script `"sync": "node scripts/sync.mjs"`.

## Archivos que se excluyen de la copia

| Patrón | Motivo |
|--------|--------|
| `node_modules` | Dependencias; se instalan aparte en destino. |
| `public/json` | Datos históricos/cache de runtime. |
| `test` | Tests; no necesarios en producción. |
| `_borrar` | Archivos temporales/basura. |
| `.github`, `.idea`, `.vscode` | Metadatos de IDE/CI. |
| `.git`, `.gitignore` | Control de versiones. |
| `logs`, `sessions`, `user_prefs` | Datos generados en runtime. |
| `instalacion.json`, `notifications.json` | Configuración/datos del entorno. |
| `*.log`, `npm-debug.log*`, `*.cookie`, `session.cookie` | Logs/sesiones. |
| `Thumbs.db`, `.DS_Store`, `Desktop.ini` | Archivos del sistema. |
| `sync.config.json`, `scripts/sync.mjs` | Herramientas de desarrollo. |
| `eslint.config.mjs` | Linter; no necesario en producción. |

## Configuración (`sync.config.json`)

```json
{
  "destination": "N:\\home\\philippe\\node.js\\tuya.1.1.0",
  "excludes": [
    "node_modules",
    "public/json",
    "test",
    "_borrar",
    ".github",
    ".idea",
    ".vscode",
    ".git",
    ".gitignore",
    "logs",
    "sessions",
    "user_prefs",
    "instalacion.json",
    "notifications.json",
    "Thumbs.db",
    "*.log",
    "npm-debug.log*",
    "*.cookie",
    "session.cookie",
    "sync.config.json",
    "scripts/sync.mjs",
    "eslint.config.mjs"
  ],
  "preserveInDestination": [
    "instalacion.json",
    "notifications.json"
  ]
}
```

## Comportamiento del script

1. Cargar `sync.config.json` desde la raíz del proyecto.
2. Resolver la ruta de destino (relativa o absoluta).
3. Si el destino no existe, crearlo recursivamente.
4. Recorrer el directorio origen.
5. Para cada archivo/carpeta:
   - Si coincide con un patrón de exclusión, omitir.
   - Si es un archivo en `preserveInDestination` y ya existe en destino, omitir.
   - Copiar/actualizar el archivo en destino.
6. Mostrar resumen final: archivos copiados, omitidos, errores.
7. Si el destino no es accesible, detenerse con mensaje de error claro.

## Ejemplo de uso

```bash
npm run sync
```

Para cambiar el destino, edita `sync.config.json` o crea otro archivo de configuración y modifica el script `package.json` para que apunte a él.

## Criterios de éxito

- `npm run sync` copia correctamente todos los archivos necesarios.
- `node_modules/`, `public/json/`, `test/` y archivos de runtime no se copian.
- `instalacion.json` y `notifications.json` existentes en destino no se sobrescriben.
- El servidor en destino arranca tras instalar dependencias (`npm install`) y ejecutar `npm start`.
