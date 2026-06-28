# Tariff Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move and rename `tariffManager.mjs` from the project root to `src/managers/tariff.mjs`. Same public API (`refrescarTarifa`, `horaIncluidaHoras`, `isCurrentHourAmongCheapest`, `getCurrentTarifaValue`), same behavior, same `<root>/public/json/` output path because `refrescarTarifa(dirname)` receives `dirname` as a parameter.

**Architecture:** Create the new file with identical content, update 4 imports + 1 lint entry, verify with a broad grep (lesson learned from the logger spec), delete the old file. One commit per change for clean revertability.

**Tech Stack:** Node.js native `fs`/`path` (as `node:fs/promises`, `node:path` — the current file uses `fs/promises` and bare `path`; preserve as-is), `pino` 10.x, `moment` 2.x, ES modules (`.mjs`).

---

## File structure

| File | Responsibility |
|------|---------------|
| `src/managers/tariff.mjs` | New location of the tariff manager. Identical content to `tariffManager.mjs` including the already-migrated logger import. |
| `tariffManager.mjs` (root) | Deleted after all imports migrate. |
| `server.mjs`, `consumptionManager.mjs` (2 sites), `test/test_horas.mjs` | Updated imports. |
| `eslint.config.mjs` | Updated lint files list. |

---

## Global Constraints

- **Project version**: `1.1.1` (package.json stays untouched).
- **File rename**: `tariffManager.mjs` → `tariff.mjs`. Drop the `Manager` suffix because the file already lives in `src/managers/`.
- **Public API**: 4 named exports with unchanged names and signatures: `refrescarTarifa(dirname)`, `horaIncluidaHoras(horasStr, horaActualNum)`, `isCurrentHourAmongCheapest(tarifa, n, horasStr)`, `getCurrentTarifaValue(tarifa)`.
- **`public/json/` path**: `<dirname>/public/json/YYYY-MM-DD_rede.json`. The `dirname` parameter is passed by `server.mjs` and points at the project root. No path resolution changes.
- **Logger import**: stays as `'./src/logging/logger.mjs'` (already migrated in the previous session).
- **`moment` and `fs/promises`, `path` imports**: stay as-is. Don't switch to `node:` prefix in this task (out of scope; would expand the diff).
- **No new dependencies**.
- **Verification**: `npm test` (6 suites), broad grep for any remaining `tariffManager` reference, smoke run of `node server.mjs` to confirm `refrescarTarifa` writes the JSON file.

---

## Task 1: Create `src/managers/tariff.mjs`

**Files:**
- Create: `src/managers/tariff.mjs`

- [ ] **Step 1: Create the new file**

Create `src/managers/tariff.mjs` with this exact content (copied from `tariffManager.mjs`, only the filename changes):

```js
import moment from 'moment';
import fs from 'fs/promises';
import path from 'path';
import logger from './src/logging/logger.mjs';

const redel = 'https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real';

export async function refrescarTarifa(dirname) {
    const diaTarifa = moment().format('YYYY-MM-DD');
    try {
        const url = `${redel}?start_date=${diaTarifa}T00:00&end_date=${diaTarifa}T23:59&time_trunc=hour`;
        const result = await fetch(url);
        const json = await result.json();

        logger.info(`Refrescando tarifa de electricidad ... ${diaTarifa}`);

        const values = json.included[0].attributes.values || [];
        const hourlyValues = values.filter(v => {
            const d = new Date(v.datetime);
            return d.getMinutes() === 0 && d.getSeconds() === 0;
        });

        const jsonDir = path.join(dirname, 'public', 'json');
        await fs.mkdir(jsonDir, { recursive: true });
        await fs.writeFile(path.join(jsonDir, `${diaTarifa}_rede.json`), JSON.stringify(hourlyValues, null, 2));

        return hourlyValues;
    } catch (ex) {
        logger.error('Error al refrescar tarifa:', ex);
        return null;
    }
}

export function horaIncluidaHoras(horasStr, horaActualNum) {
  if (!horasStr) return true;
  try {
    const parts = horasStr.toString().split(',').map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      if (part.includes('-')) {
        const [startStr, endStr] = part.split('-').map(s => s.trim());
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (isNaN(start) || isNaN(end)) continue;
        if (start <= end) {
          if (horaActualNum >= start && horaActualNum <= end) return true;
        } else {
          // rango con wrap-around, ej 20-6
          if (horaActualNum >= start || horaActualNum <= end) return true;
        }
      } else {
        const h = parseInt(part, 10);
        if (!isNaN(h) && horaActualNum === h) return true;
      }
    }
    return false;
  } catch (e) {
    logger.error('Error parseando Horas:', e);
    return false;
  }
}

export function isCurrentHourAmongCheapest(tarifa, n, horasStr) {
    if (!tarifa || tarifa.length === 0) return false;

    const now = new Date();
    const localHour = now.getHours();
    const localDate = now.toISOString().slice(0, 10);

    // Filtrar tarifa únicamente para hoy
    const tarifaHoy = tarifa.filter(t => new Date(t.datetime).toISOString().slice(0, 10) === localDate);

    // Si se especifican `Horas`, limitar candidatos a esas horas
    let candidatos = tarifaHoy;
    if (horasStr) {
        candidatos = tarifaHoy.filter(t => horaIncluidaHoras(horasStr, new Date(t.datetime).getHours()));
    }

    if (!candidatos || candidatos.length === 0) return false;

    const cheapest = [...candidatos]
        .sort((a, b) => a.value - b.value)
        .slice(0, n);

    return cheapest.some(t => new Date(t.datetime).getHours() === localHour);
}

export function getCurrentTarifaValue(tarifa) {
    if (!tarifa) return null;
    const now = new Date();
    const localHour = now.getHours();
    const localDate = now.toISOString().slice(0, 10);

    const item = tarifa.find(t => {
        const tDate = new Date(t.datetime);
        return (
            tDate.getHours() === localHour &&
            tDate.toISOString().slice(0, 10) === localDate
        );
    });

    return item ? item.value : null;
}
```

- [ ] **Step 2: Verify the file parses**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/src/managers/tariff.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add src/managers/tariff.mjs
git commit -m "feat: add src/managers/tariff.mjs (moved from tariffManager.mjs)"
```

---

## Task 2: Update `server.mjs` import

**Files:**
- Modify: `server.mjs:17`

- [ ] **Step 1: Change the import**

In `server.mjs`, line 17, replace:
```js
import { refrescarTarifa, getCurrentTarifaValue, isCurrentHourAmongCheapest } from './tariffManager.mjs';
```
with:
```js
import { refrescarTarifa, getCurrentTarifaValue, isCurrentHourAmongCheapest } from './src/managers/tariff.mjs';
```

- [ ] **Step 2: Verify**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/server.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add server.mjs
git commit -m "refactor: point server.mjs to src/managers/tariff.mjs"
```

---

## Task 3: Update `consumptionManager.mjs` import (line 6)

**Files:**
- Modify: `consumptionManager.mjs:6`

- [ ] **Step 1: Change the import**

In `consumptionManager.mjs`, line 6, replace:
```js
import { isCurrentHourAmongCheapest, refrescarTarifa, horaIncluidaHoras } from './tariffManager.mjs';
```
with:
```js
import { isCurrentHourAmongCheapest, refrescarTarifa, horaIncluidaHoras } from './src/managers/tariff.mjs';
```

- [ ] **Step 2: Verify**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/consumptionManager.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add consumptionManager.mjs
git commit -m "refactor: point consumptionManager.mjs import to src/managers/tariff.mjs"
```

---

## Task 4: Update `consumptionManager.mjs` re-export (line 9)

**Files:**
- Modify: `consumptionManager.mjs:9`

- [ ] **Step 1: Change the re-export**

In `consumptionManager.mjs`, line 9, replace:
```js
export { horaIncluidaHoras as horaIncluida } from './tariffManager.mjs';
```
with:
```js
export { horaIncluidaHoras as horaIncluida } from './src/managers/tariff.mjs';
```

- [ ] **Step 2: Verify**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/consumptionManager.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add consumptionManager.mjs
git commit -m "refactor: point consumptionManager.mjs re-export to src/managers/tariff.mjs"
```

---

## Task 5: Update `test/test_horas.mjs` import

**Files:**
- Modify: `test/test_horas.mjs:3`

Note: This file lives in `test/`, so the path uses `../`. The logger spec missed a similar case (`test/test_check_awaits.mjs` with `'../logger.mjs'`); this task exists specifically to handle it.

- [ ] **Step 1: Change the import**

In `test/test_horas.mjs`, line 3, replace:
```js
import { horaIncluidaHoras, isCurrentHourAmongCheapest } from '../tariffManager.mjs';
```
with:
```js
import { horaIncluidaHoras, isCurrentHourAmongCheapest } from '../src/managers/tariff.mjs';
```

- [ ] **Step 2: Verify**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/test/test_horas.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add test/test_horas.mjs
git commit -m "refactor: point test_horas.mjs to src/managers/tariff.mjs"
```

---

## Task 6: Update `eslint.config.mjs` lint files list

**Files:**
- Modify: `eslint.config.mjs:26`

The second lint block (line 26) lists Node-side files explicitly. `tariffManager.mjs` is in the list; `src/managers/tariff.mjs` needs to be added (and `tariffManager.mjs` will be removed by Task 8 once the file is gone).

- [ ] **Step 1: Change the entry**

In `eslint.config.mjs`, line 26, replace the part:
```js
'tariffManager.mjs'
```
with:
```js
'src/managers/tariff.mjs'
```

The full line 26 should now be:
```js
        files: ['*.mjs', 'server.mjs', 'config.mjs', 'tuyaClient.mjs', 'consumptionManager.mjs', 'src/managers/tariff.mjs', 'weatherManager.mjs', 'alertManager.mjs'],
```

Note: the line length grows slightly. This is acceptable (no project-enforced line-length limit).

- [ ] **Step 2: Verify the lint config parses**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/eslint.config.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add eslint.config.mjs
git commit -m "chore: update eslint config to lint src/managers/tariff.mjs"
```

---

## Task 7: Verify no module still references `tariffManager`

**Files:**
- (read-only grep + tests)

- [ ] **Step 1: Broad grep — the lesson from the logger spec**

Run:
```bash
grep -rn "tariffManager" --include="*.mjs" --include="*.js" /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/
```

Expected: no output. Every consumer now points to `./src/managers/tariff.mjs` or `../src/managers/tariff.mjs`.

If any match appears, STOP and report BLOCKED with the match — that consumer was missed.

- [ ] **Step 2: Verify the old file still works (don't delete yet)**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/tariffManager.mjs
```

Expected: no output. The old file is still valid (it imports the new logger too, since it was already migrated). It just has no consumers anymore.

- [ ] **Step 3: Run the full test suite**

Run:
```bash
cd /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home && npm test
```

Expected: 6 suites pass (`test_horas`, `test_check_awaits`, `test_require_admin`, `test_save_atomic`, `test_session`, `test_cors`).

`test_horas.mjs` is the critical suite for this migration: it imports `horaIncluidaHoras` and `isCurrentHourAmongCheapest` from the new path.

- [ ] **Step 4: Smoke-run the server to confirm `refrescarTarifa` writes the JSON file**

Run:
```bash
cd /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home
node server.mjs > /tmp/servidor-tarifa.log 2>&1 &
SERVER_PID=$!
sleep 3
ls -la public/json/*_rede.json 2>&1 | head -3
kill $SERVER_PID
wait $SERVER_PID 2>/dev/null
echo "--- server log tail ---"
tail -5 /tmp/servidor-tarifa.log
```

Expected: at least one `YYYY-MM-DD_rede.json` file present (created or refreshed in the last 3 seconds). Server log shows `Refrescando tarifa de electricidad ... YYYY-MM-DD` or a graceful REE error.

If the server fails to start with `MODULE_NOT_FOUND` for `tariffManager`, STOP and report BLOCKED — a consumer was missed.

---

## Task 8: Delete the old `tariffManager.mjs`

**Files:**
- Delete: `tariffManager.mjs` (root)

- [ ] **Step 1: Remove the file**

Run:
```bash
rm /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/tariffManager.mjs
```

- [ ] **Step 2: Verify the project still runs**

Run:
```bash
cd /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home
timeout 4 node server.mjs 2>&1 | tail -10
```

Expected: listening message (e.g. `Servidor montado en 0.0.0.0:3000`), no `MODULE_NOT_FOUND` for `./tariffManager.mjs` or `../tariffManager.mjs`.

- [ ] **Step 3: Run the full test suite one more time**

Run:
```bash
cd /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home && npm test
```

Expected: 6 suites pass.

- [ ] **Step 4: Confirm the old file is gone**

Run:
```bash
ls /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/tariffManager.mjs 2>&1
```

Expected: `No such file or directory`.

- [ ] **Step 5: Final broad grep**

Run:
```bash
grep -rn "tariffManager" --include="*.mjs" --include="*.js" /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/
```

Expected: no output. Old filename fully eradicated from code.

- [ ] **Step 6: Commit**

```bash
git add -u tariffManager.mjs
git commit -m "chore: remove legacy root tariffManager.mjs after migration to src/managers/"
```

---

## Self-Review Checklist

- [x] Spec coverage: every requirement in `docs/superpowers/specs/2026-06-28-tariff-migration-design.md` maps to a task (Task 1 = new file, Tasks 2-6 = imports + lint, Task 7 = verification, Task 8 = deletion).
- [x] Placeholder scan: no "TBD", "TODO", or vague instructions. Every code step shows the exact replacement.
- [x] Type/signature consistency: same 4 named exports with same signatures. `dirname` parameter preserved.
- [x] Order: new file exists before any consumer switches to it (Task 1 → Tasks 2-6), so the project never has a broken state in git history.
- [x] Final state: only `src/managers/tariff.mjs` exists; no consumer references the old path; `npm test` green.
- [x] Lesson applied: Task 7's grep is broad (`*.mjs`, `*.js`, whole tree), not narrow like the logger spec's grep. Task 5 explicitly handles `test/`'s `../` prefix.