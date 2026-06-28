# Logger Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `logger.mjs` from the project root to `src/logging/logger.mjs` as part of the incremental `src/` migration, preserving the public API (`logger.info/warn/error` + `logFile`) and keeping `logs/` in the project root.

**Architecture:** The new module computes the project root by resolving `src/logging/` up two levels from `import.meta.url`, then joins `logs/server.log` exactly like the original. Imports change from `./logger.mjs` to `./src/logging/logger.mjs` in eight root files; `src/api/middleware/session.mjs` is not touched because it already receives the logger via injection (the `onWarn` callback).

**Tech Stack:** Node.js native `fs`/`path`/`url` modules (as `node:`), `pino` 10.x, `pino-pretty` 13.x, ES modules (`.mjs`).

---

## File structure

| File | Responsibility |
|------|---------------|
| `src/logging/logger.mjs` | New location of the pino singleton. Resolves `projectRoot` from `import.meta.url` and configures two transports (`pino/file` always, `pino-pretty` in dev). |
| `logger.mjs` (root) | Deleted after all imports migrate. |
| 8 root modules | Updated imports: `from './logger.mjs'` → `from './src/logging/logger.mjs'`. |

No new tests (covered indirectly by `npm test`).

---

## Global Constraints

- **Project version**: `1.1.1` (package.json stays untouched).
- **Public API**: `export default logger` and `export { logFile }` — unchanged.
- **`logs/` location**: stays in project root, not under `src/`.
- **`src/api/middleware/session.mjs`**: untouched. It uses injected `onWarn`, no direct import.
- **Built-in module imports**: use `node:fs`, `node:path`, `node:url` (modern convention).
- **No new dependencies**: `pino` and `pino-pretty` are already in `package.json`.
- **Verification**: `npm test` (all 6 suites) + manual `node server.mjs` smoke after the final task.

---

## Task 1: Create `src/logging/logger.mjs`

**Files:**
- Create: `src/logging/logger.mjs`

**Interfaces:**
- Consumes: nothing (entry point).
- Produces: `default export logger` (pino instance), `named export logFile` (absolute path to `logs/server.log`).

- [ ] **Step 1: Create the new file**

Create `src/logging/logger.mjs` with this exact content:

```js
import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the project root from this module's location.
 *
 * This file lives at `<root>/src/logging/logger.mjs`, so the root is two
 * levels up. If this file is ever moved to a different depth, update the
 * number of `..` segments accordingly.
 */
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

- [ ] **Step 2: Smoke-load the module**

Run:
```bash
node --input-type=module -e "import logger, { logFile } from './src/logging/logger.mjs'; logger.info('hello'); console.log('logFile:', logFile);" 2>&1 | tail -5
```

Expected: a single line of pretty output containing `hello`, then a line with `logFile: /<absolute>/<project-root>/logs/server.log`. The absolute path must end in `logs/server.log` (project root, NOT `src/logging/logs/server.log`).

- [ ] **Step 3: Verify the file landed in `logs/`**

Run:
```bash
tail -1 logs/server.log
```

Expected: a JSON line with the `"msg":"hello"` field, confirming the file transport wrote to the project root.

- [ ] **Step 4: Commit**

```bash
git add src/logging/logger.mjs
git commit -m "feat: add src/logging/logger.mjs with project-root path resolution"
```

---

## Task 2: Update `server.mjs` import

**Files:**
- Modify: `server.mjs:14`

**Interfaces:**
- Consumes: `src/logging/logger.mjs` default export.
- Produces: unchanged — `server.mjs` continues to use `logger.info/warn/error` and `logger.logFile` (the latter in the `GET /log/:lin` handler).

- [ ] **Step 1: Change the import**

In `server.mjs`, line 14, replace:
```js
import logger from './logger.mjs';
```
with:
```js
import logger from './src/logging/logger.mjs';
```

- [ ] **Step 2: Verify the import resolves**

Run:
```bash
node --check server.mjs
```

Expected: no output (success).

- [ ] **Step 3: Smoke-run the server briefly**

Run:
```bash
timeout 4 node server.mjs 2>&1 | tail -15
```

Expected: an `[Server]` listening message, then a clean SIGTERM exit. No `MODULE_NOT_FOUND` or pino initialization errors.

- [ ] **Step 4: Confirm `logs/server.log` still receives entries**

Run:
```bash
tail -3 logs/server.log
```

Expected: at least one new JSON line with the listening message timestamped after this task's smoke run.

- [ ] **Step 5: Commit**

```bash
git add server.mjs
git commit -m "refactor: point server.mjs to src/logging/logger.mjs"
```

---

## Task 3: Update `config.mjs` import

**Files:**
- Modify: `config.mjs:5`

- [ ] **Step 1: Change the import**

In `config.mjs`, line 5, replace:
```js
import logger from './logger.mjs';
```
with:
```js
import logger from './src/logging/logger.mjs';
```

- [ ] **Step 2: Verify the import resolves**

Run:
```bash
node --check config.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add config.mjs
git commit -m "refactor: point config.mjs to src/logging/logger.mjs"
```

---

## Task 4: Update `tuyaClient.mjs` import

**Files:**
- Modify: `tuyaClient.mjs:3`

- [ ] **Step 1: Change the import**

In `tuyaClient.mjs`, line 3, replace:
```js
import logger from './logger.mjs';
```
with:
```js
import logger from './src/logging/logger.mjs';
```

- [ ] **Step 2: Verify the import resolves**

Run:
```bash
node --check tuyaClient.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add tuyaClient.mjs
git commit -m "refactor: point tuyaClient.mjs to src/logging/logger.mjs"
```

---

## Task 5: Update `consumptionManager.mjs` import

**Files:**
- Modify: `consumptionManager.mjs:4`

- [ ] **Step 1: Change the import**

In `consumptionManager.mjs`, line 4, replace:
```js
import logger from './logger.mjs';
```
with:
```js
import logger from './src/logging/logger.mjs';
```

- [ ] **Step 2: Verify the import resolves**

Run:
```bash
node --check consumptionManager.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add consumptionManager.mjs
git commit -m "refactor: point consumptionManager.mjs to src/logging/logger.mjs"
```

---

## Task 6: Update `tariffManager.mjs` import

**Files:**
- Modify: `tariffManager.mjs:4`

- [ ] **Step 1: Change the import**

In `tariffManager.mjs`, line 4, replace:
```js
import logger from './logger.mjs';
```
with:
```js
import logger from './src/logging/logger.mjs';
```

- [ ] **Step 2: Verify the import resolves**

Run:
```bash
node --check tariffManager.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add tariffManager.mjs
git commit -m "refactor: point tariffManager.mjs to src/logging/logger.mjs"
```

---

## Task 7: Update `weatherManager.mjs` import

**Files:**
- Modify: `weatherManager.mjs:6`

- [ ] **Step 1: Change the import**

In `weatherManager.mjs`, line 6, replace:
```js
import logger from './logger.mjs';
```
with:
```js
import logger from './src/logging/logger.mjs';
```

- [ ] **Step 2: Verify the import resolves**

Run:
```bash
node --check weatherManager.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add weatherManager.mjs
git commit -m "refactor: point weatherManager.mjs to src/logging/logger.mjs"
```

---

## Task 8: Update `alertManager.mjs` import

**Files:**
- Modify: `alertManager.mjs:3`

- [ ] **Step 1: Change the import**

In `alertManager.mjs`, line 3, replace:
```js
import logger from './logger.mjs';
```
with:
```js
import logger from './src/logging/logger.mjs';
```

- [ ] **Step 2: Verify the import resolves**

Run:
```bash
node --check alertManager.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add alertManager.mjs
git commit -m "refactor: point alertManager.mjs to src/logging/logger.mjs"
```

---

## Task 9: Update `retentionManager.mjs` import

**Files:**
- Modify: `retentionManager.mjs:8`

- [ ] **Step 1: Change the import**

In `retentionManager.mjs`, line 8, replace:
```js
import logger from './logger.mjs';
```
with:
```js
import logger from './src/logging/logger.mjs';
```

- [ ] **Step 2: Verify the import resolves**

Run:
```bash
node --check retentionManager.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add retentionManager.mjs
git commit -m "refactor: point retentionManager.mjs to src/logging/logger.mjs"
```

---

## Task 10: Verify no module still references `./logger.mjs`

**Files:**
- (read-only grep)

- [ ] **Step 1: Grep for remaining references**

Run:
```bash
grep -rn "from './logger.mjs'" --include="*.mjs" /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/
```

Expected: no output. Every consumer now points to `./src/logging/logger.mjs`.

- [ ] **Step 2: Run the full test suite**

Run:
```bash
npm test
```

Expected: 6 suites pass (same as before the migration: `test_horas`, `test_check_awaits`, `test_require_admin`, `test_save_atomic`, `test_session`, `test_cors`).

- [ ] **Step 3: Smoke-run the server and hit `/log/0`**

Run:
```bash
node server.mjs > /tmp/server.log 2>&1 &
SERVER_PID=$!
sleep 2
curl -s -o /tmp/log0.txt -w "HTTP %{http_code}\n" http://localhost:3000/log/0
kill $SERVER_PID
wait $SERVER_PID 2>/dev/null
echo "--- response head ---"
head -3 /tmp/log0.txt
```

Expected: `HTTP 200`, and `/tmp/log0.txt` contains the latest lines from `logs/server.log` (the endpoint streams the file content). This confirms `logger.logFile` is still exported with the correct path.

---

## Task 11: Delete the old `logger.mjs`

**Files:**
- Delete: `logger.mjs` (root)

- [ ] **Step 1: Remove the file**

Run:
```bash
rm /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/logger.mjs
```

- [ ] **Step 2: Verify the project still runs**

Run:
```bash
timeout 4 node server.mjs 2>&1 | tail -10
```

Expected: `[Server] listening on …` line, no `MODULE_NOT_FOUND` for `./logger.mjs`.

- [ ] **Step 3: Run the full test suite one more time**

Run:
```bash
npm test
```

Expected: 6 suites pass.

- [ ] **Step 4: Confirm the old file is gone**

Run:
```bash
ls /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/logger.mjs 2>&1
```

Expected: `No such file or directory`.

- [ ] **Step 5: Commit**

```bash
git add -u logger.mjs
git commit -m "chore: remove legacy root logger.mjs after migration to src/logging/"
```

---

## Self-Review Checklist

- [x] Spec coverage: every requirement in `docs/superpowers/specs/2026-06-28-logger-migration-design.md` maps to a task (Task 1 = new file, Tasks 2–9 = imports, Tasks 10–11 = verification + deletion).
- [x] Placeholder scan: no "TBD", "TODO", or vague instructions. Every code step shows the exact replacement.
- [x] Type/signature consistency: `import logger from './src/logging/logger.mjs'` is identical across all 8 files (default import). `logFile` named export unchanged.
- [x] Order: new file exists before any consumer switches to it (Task 1 → Tasks 2–9), so the project never has a broken state in git history.
- [x] Final state: only `src/logging/logger.mjs` exists; no consumer references the old path; `npm test` green.