# Diseño: Migración de `tariffManager.mjs` a `src/managers/tariff.mjs`

## Resumen

Mover y renombrar `tariffManager.mjs` desde la raíz a `src/managers/tariff.mjs` como continuación de la migración incremental a `src/`. El archivo **no usa `__dirname`**: recibe `dirname` como parámetro en `refrescarTarifa(dirname)` y construye `public/json/` desde él. Esto significa que la ruta de salida (`<raíz>/public/json/`) se conserva automáticamente porque el consumidor (`server.mjs`) sigue pasándole la raíz del proyecto.

## Contexto

`tariffManager.mjs` expone cuatro funciones de gestión de la tarifa eléctrica horaria española (PVPC):

- `refrescarTarifa(dirname)` — descarga precios PVPC del día en curso desde REE y los persiste en `<dirname>/public/json/YYYY-MM-DD_rede.json`.
- `horaIncluidaHoras(horasStr, horaActualNum)` — evalúa si una hora está dentro de la ventana válida definida en `instalacion.json` (formato lista o rango con wrap-around tipo `20-6`).
- `isCurrentHourAmongCheapest(tarifa, n, horasStr)` — combina los anteriores para decidir si la hora actual está entre las `n` más baratas.
- `getCurrentTarifaValue(tarifa)` — devuelve el valor de la hora actual de un array de tarifa ya cargado.

El archivo importa `pino` logger (ya migrado en la sesión anterior) y `moment` (no migrado).

## Consumidores

Cuatro archivos importan desde `tariffManager.mjs` (los tres primeros desde la raíz, el cuarto desde `test/`):

- `server.mjs:17` — `refrescarTarifa`, `getCurrentTarifaValue`, `isCurrentHourAmongCheapest`
- `consumptionManager.mjs:6` — `isCurrentHourAmongCheapest`, `refrescarTarifa`, `horaIncluidaHoras`
- `consumptionManager.mjs:9` — `export { horaIncluidaHoras as horaIncluida } from './tariffManager.mjs';` (re-export con alias para el visor `/log/:lin` y la UI)
- `test/test_horas.mjs:3` — `horaIncluidaHoras`, `isCurrentHourAmongCheapest` (path relativo `../tariffManager.mjs` desde `test/`)

Adicionalmente, `eslint.config.mjs:26` enumera `tariffManager.mjs` en una lista explícita de archivos cubiertos por el lint de Node. **No es un import**, pero conviene actualizar la entrada a `src/managers/tariff.mjs` para que el lint siga cubriendo el archivo en su nueva ubicación.

## Decisiones de diseño

- **Mover y renombrar** simultáneamente: `tariffManager.mjs` → `src/managers/tariff.mjs`. El sufijo `Manager` no aporta información cuando el archivo ya vive en `src/managers/`. Coherente con `logger.mjs` (sin sufijo).
- **Firma de `refrescarTarifa(dirname)` se conserva**: el módulo sigue recibiendo `dirname` por parámetro. No se introduce `import.meta.url` ni `path.dirname`. La ruta de salida (`public/json/`) sigue calculándose relativa al parámetro, así que el archivo de tarifa persistido termina en `<raíz>/public/json/YYYY-MM-DD_rede.json` igual que antes.
- **API pública intacta**: los cuatro exports mantienen nombre y firma. Sin factory, sin DI.
- **Comportamiento idéntico**: ningún cambio funcional. La migración es estrictamente de ubicación + nombre de archivo.
- **Plan con verificación de grep mejorada**: tras la migración, el plan debe comprobar que no queda NINGÚN import a `tariffManager.mjs` (en cualquier path relativo), replicando la lección aprendida en el spec del logger donde `test/test_check_awaits.mjs` usaba `'../logger.mjs'` y se nos pasó.

## Archivos a crear

- `src/managers/tariff.mjs` — copia exacta del contenido de `tariffManager.mjs` (incluido el import ya migrado a `'./src/logging/logger.mjs'`).

## Archivos a modificar (imports + lint)

| Archivo | Línea | Cambio |
|---------|-------|--------|
| `server.mjs` | 17 | `'./tariffManager.mjs'` → `'./src/managers/tariff.mjs'` |
| `consumptionManager.mjs` | 6 | `'./tariffManager.mjs'` → `'./src/managers/tariff.mjs'` |
| `consumptionManager.mjs` | 9 | `'./tariffManager.mjs'` → `'./src/managers/tariff.mjs'` (re-export con alias) |
| `test/test_horas.mjs` | 3 | `'../tariffManager.mjs'` → `'../src/managers/tariff.mjs'` |
| `eslint.config.mjs` | 26 | `'tariffManager.mjs'` → `'src/managers/tariff.mjs'` (lista de files del lint) |

## Archivos a eliminar

- `tariffManager.mjs` (raíz)

## Comportamiento

Sin cambios:

- Misma firma de las cuatro funciones exportadas.
- Misma ruta de salida `<raíz>/public/json/YYYY-MM-DD_rede.json`.
- Mismo manejo de errores en `refrescarTarifa` (try/catch → logger.error + null).
- Mismo formato de `Horas` parseado por `horaIncluidaHoras`.
- Misma lógica de filtrado y ordenación en `isCurrentHourAmongCheapest` y `getCurrentTarifaValue`.

## Verificación

1. `grep -rn "tariffManager" --include="*.mjs" --include="*.js"` debe devolver **cero** matches en archivos de código. Las únicas ocurrencias legítimas son `docs/superpowers/specs/2026-06-28-tariff-migration-design.md` (este spec) y los notes de progreso en `.superpowers/sdd/`.
2. `npm test` debe pasar las 6 suites igual que antes. `test_horas.mjs` es la cobertura crítica: ejercita `horaIncluidaHoras` con varios formatos y `isCurrentHourAmongCheapest` con la tarifa real.
3. `node server.mjs` debe arrancar, ejecutar `refrescarTarifa` en background (línea ~120 de `server.mjs`) y dejar un fichero `public/json/<fecha>_rede.json` actualizado.

## Fuera de alcance (explícito)

- **Mover `horaIncluidaHoras` a `src/utils/`**: sería una refactorización útil pero independiente. No se hace aquí.
- **Inyección de dependencias** (`setDependencies` al estilo de `consumptionManager`): mismo motivo.
- **Tests dedicados** para `tariff.mjs`: cobertura indirecta vía `test_horas.mjs`.
- **Cambio en la firma de `refrescarTarifa`**: se mantiene `dirname` como parámetro.
- **Renombrar `consumptionManager.mjs`** aún: se hace cuando le toque migrarse.

## Riesgos

- **Renombrado + movimiento simultáneos**: si se hace solo uno (mover sin renombrar, o renombrar sin mover), se rompe. Por eso el plan debe mover el contenido al archivo nuevo y mantener el viejo hasta que todos los imports apunten al nuevo. Mismo patrón que el spec del logger.
- **`eslint.config.mjs`**: si se olvida actualizar la lista de files, el lint deja de cubrir el archivo en su nueva ubicación. Es cosmético (no falla compilación ni tests) pero conviene arreglarlo en este spec.
- **Lección del spec anterior**: el grep del plan debe buscar `tariffManager` por todo el árbol, no solo `'./tariffManager.mjs'`. El spec del logger tuvo un gap con `'../logger.mjs'`; el plan de este spec lo evita buscando ambos patrones (`./` y `../`).
