# Tuya Client Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move and rename `tuyaClient.mjs` from the project root to `src/api/tuya/client.mjs`. Same 9 named exports, same behavior, same module-level state (token cache + config injected via `initTuya`).

**Architecture:** Create the new file with the single internal import **already corrected** for the new directory depth (lesson consolidated from logger, tariff, weather — see Task 1 below). Update 5 references (3 imports + 1 lint list + 1 backup script). Verify with a broad grep. Delete the old file. One commit per change for clean revertability.

**Tech Stack:** Node.js native `crypto` (kept bare, not `node:` prefixed, per spec — same as tariff), `axios` 1.x, `pino` 10.x (via `../../logging/logger.mjs`), ES modules (`.mjs`).

---

## File structure

| File | Responsibility |
|------|---------------|
| `src/api/tuya/client.mjs` | New location of the Tuya HTTP client. Identical to `tuyaClient.mjs` BUT with the logger import adjusted for the new directory depth. |
| `tuyaClient.mjs` (root) | Deleted after all imports migrate. |
| `server.mjs`, `consumptionManager.mjs`, `src/managers/weather.mjs` | Updated imports. |
| `eslint.config.mjs` | Updated lint files list. |
| `scripts/backup.sh` | Updated FILES array. |

---

## Global Constraints

- **Project version**: `1.1.1` (package.json stays untouched).
- **File rename**: `tuyaClient.mjs` → `client.mjs`. Drop the `tuya` prefix because the file already lives in `src/api/tuya/`. The file does NOT have a `Manager` suffix.
- **Public API**: 9 named exports with unchanged names and signatures:
  - `initTuya(tuyaConfig)`
  - `API_PATHS` (constant)
  - `makeRequest(path, method, body)`
  - `getEstado(deviceId)`
  - `getInfo(deviceId)`
  - `getTodosDispositivos(uid)`
  - `detectUid(identificadores)`
  - `alternar(deviceId, state, instalacion, identificadores)`
  - `getSwitchValue(response, interruptor)`
- **Module-level state preserved**: `config`, `token`, `tokenExpireTime`, `tokenPromise` keep their behavior (token cache TTL, concurrent-call deduplication).
- **Internal import** (CRITICAL — applied lesson from logger/tariff/weather):
  - `logger` import: `'./src/logging/logger.mjs'` → `'../../logging/logger.mjs'`. From `src/api/tuya/`, two levels up reach the project root; `src/logging/logger.mjs` is one level into `src/`.
- **`axios`, `crypto` imports**: stay as-is. Bare, not `node:` prefixed (matches spec).
- **No new dependencies**.
- **No new tests** (parity with logger, tariff, weather).
- **Verification**: `npm test` (6 suites, none exercises tuyaClient directly — coverage is syntactic + smoke), broad grep for `tuyaClient`, smoke run of `node server.mjs` to confirm the module loads without `MODULE_NOT_FOUND`. Note: actual Tuya API calls may fail with 401/network errors due to credentials — this is acceptable; what matters is the module loads.

---

## Task 1: Create `src/api/tuya/client.mjs`

**Files:**
- Create: `src/api/tuya/client.mjs`

**CRITICAL**: The file must have the internal import adjusted from the start. This is the 4th application of the consolidated lesson (logger → tariff → weather → tuya). The implementer's brief shows the import ALREADY corrected; Step 3 of this task verifies it before any commit.

- [ ] **Step 1: Create the new file**

Create `src/api/tuya/client.mjs` with this EXACT content. Note the **single adjusted import line** (highlighted in a comment):

```js
import axios from 'axios';
import crypto from 'crypto';
// ADJUSTED: was './src/logging/logger.mjs' in the root file. From src/api/tuya/, go up two levels (../../) to the project root, then into src/logging/.
import logger from '../../logging/logger.mjs';

let config = null;
let token = null;
let tokenExpireTime = 0;
let tokenPromise = null;

export function initTuya(tuyaConfig) {
    config = tuyaConfig;
}

export const API_PATHS = {
    token: '/v1.0/token?grant_type=1',
    info: (deviceId) => `/v1.0/devices/${deviceId}`,
    userDevices: (uid) => `/v1.0/users/${uid}/devices?page_no=1&page_size=100`,
    allDevices: (pageNo, pageSize) => `/v1.3/iot-03/devices?page_no=${pageNo}&page_size=${pageSize}`,
    commands: (deviceId) => `/v1.0/devices/${deviceId}/commands`,
    functions: (deviceId) => `/v1.0/devices/${deviceId}/functions`,
    status: (deviceId) => `/v1.0/devices/${deviceId}/status`
};

/**
 * Genera la firma para la API de Tuya (V2)
 */
function calculateSign(clientId, secret, t, accessToken, method, path, body = null) {
    const contentHash = crypto.createHash('sha256').update(body ? JSON.stringify(body) : '').digest('hex');
    const stringToSign = [
        method.toUpperCase(),
        contentHash,
        '', // headers empty
        path
    ].join('\n');

    const signStr = clientId + (accessToken || '') + t + stringToSign;
    return crypto.createHmac('sha256', secret).update(signStr).digest('hex').toUpperCase();
}

async function getAccessToken() {
    if (token && Date.now() < tokenExpireTime) {
        return token;
    }

    if (tokenPromise) return tokenPromise;

    tokenPromise = (async () => {
        const timestamp = Date.now().toString();
        const signUrl = API_PATHS.token;
        const sign = calculateSign(config.accessKey, config.secretKey, timestamp, null, 'GET', signUrl);

        try {
            const response = await axios.get(config.baseUrl + signUrl, {
                headers: {
                    t: timestamp,
                    sign_method: 'HMAC-SHA256',
                    client_id: config.accessKey,
                    sign: sign
                }
            });

            if (response.data.success) {
                token = response.data.result.access_token;
                tokenExpireTime = Date.now() + (response.data.result.expire_time - 60) * 1000;
                return token;
            } else {
                throw new Error(`Tuya Auth Error: ${response.data.msg}`);
            }
        } catch (error) {
            logger.error({ err: error }, 'Error fetching access token:');
            throw error;
        } finally {
            tokenPromise = null;
        }
    })();

    return tokenPromise;
}

export async function makeRequest(path, method, body = null) {
    const accessToken = await getAccessToken();
    const timestamp = Date.now().toString();
    const sign = calculateSign(config.accessKey, config.secretKey, timestamp, accessToken, method, path, body);

    try {
        const url = config.baseUrl + path;
        const options = {
            method,
            url,
            headers: {
                t: timestamp,
                sign_method: 'HMAC-SHA256',
                client_id: config.accessKey,
                sign: sign,
                access_token: accessToken
            },
            data: body
        };
        const response = await axios(options);
        return response.data;
    } catch (error) {
        logger.error({ err: error }, `Tuya API Error (${path}):`);
        throw error;
    }
}

export async function getEstado(deviceId) {
    return await makeRequest(API_PATHS.status(deviceId), 'GET');
}

export async function getInfo(deviceId) {
    return await makeRequest(API_PATHS.info(deviceId), 'GET');
}

/**
 * Gets all devices associated with a specific Tuya User ID
 */
export async function getTodosDispositivos(uid) {
    if (uid) {
        return await makeRequest(API_PATHS.userDevices(uid), 'GET');
    }
    // Fallback si no hay UID proporcionado
    return await makeRequest(API_PATHS.allDevices(1, 100), 'GET');
}

/**
 * Intenta detectar el UID de la cuenta consultando cualquier dispositivo.
 */
export async function detectUid(identificadores) {
    if (!identificadores) return null;
    const ids = Object.keys(identificadores);
    // Probamos solo con los 3 primeros para no saturar si hay problemas
    const slice = ids.slice(0, 3);
    for (const id of slice) {
        try {
            const info = await getInfo(id);
            if (info.success && info.result && info.result.uid) {
                return info.result.uid;
            }
        } catch (e) {
            // Ignorar y seguir
        }
    }
    return null;
}

/**
 * Toggles device state
 */
export async function alternar(deviceId, state, instalacion, identificadores) {
    let interruptor = "switch_1";

    if (![0, 1].includes(state)) {
        return { success: false, msg: 'Invalid state' };
    }

    if (identificadores != null && deviceId in identificadores) {
        const sectionKey = identificadores[deviceId];
        const deviceConfig = (instalacion.Dispositivos && instalacion.Dispositivos[sectionKey]) || instalacion[sectionKey];
        if (deviceConfig?.Interruptor) {
            interruptor = deviceConfig.Interruptor;
        }
    }

    try {
        return await makeRequest(
            API_PATHS.commands(deviceId),
            'POST',
            {
                commands: [{
                    code: interruptor,
                    value: state === 1
                }]
            }
        );
    } catch (error) {
        return { success: false, msg: error.message };
    }
}

export function getSwitchValue(response, interruptor) {
    if (!response || !response.result) return null;
    const item = response.result.find(r => r.code === interruptor);
    return item ? item.value : null;
}
```

**REMOVE THE `// ADJUSTED:` COMMENT BEFORE COMMITTING.** It is scaffolding for the implementer; the actual file should not have it.

After removing the comment, the relevant line is:
```js
import logger from '../../logging/logger.mjs';
```

- [ ] **Step 2: Verify the file parses**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/src/api/tuya/client.mjs
```

Expected: no output (success).

- [ ] **Step 3: Confirm the import resolves correctly (load-time test)**

This is the critical check that the tariff plan and weather plan both relied on. Run:
```bash
cd /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home
node --input-type=module -e "import('./src/api/tuya/client.mjs').then(m => console.log('exports:', Object.keys(m).sort())).catch(e => { console.error('FAIL:', e.code, e.message); process.exit(1); })" 2>&1 | tail -3
```

Expected: `exports: [ 'API_PATHS', 'alternar', 'detectUid', 'getEstado', 'getInfo', 'getSwitchValue', 'getTodosDispositivos', 'initTuya', 'makeRequest' ]` (9 exports, alphabetical).

If `ERR_MODULE_NOT_FOUND` for `'../../logging/logger.mjs'` appears, STOP and report BLOCKED — the import was not adjusted correctly.

- [ ] **Step 4: Commit**

```bash
git add src/api/tuya/client.mjs
git commit -m "feat: add src/api/tuya/client.mjs (moved from tuyaClient.mjs)"
```

---

## Task 2: Update `server.mjs` import

**Files:**
- Modify: `server.mjs:16`

- [ ] **Step 1: Change the import**

In `server.mjs`, line 16, replace:
```js
import { initTuya, getEstado, getInfo, getTodosDispositivos, alternar, API_PATHS, makeRequest, detectUid } from './tuyaClient.mjs';
```
with:
```js
import { initTuya, getEstado, getInfo, getTodosDispositivos, alternar, API_PATHS, makeRequest, detectUid } from './src/api/tuya/client.mjs';
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
git commit -m "refactor: point server.mjs to src/api/tuya/client.mjs"
```

---

## Task 3: Update `consumptionManager.mjs` import

**Files:**
- Modify: `consumptionManager.mjs:5`

- [ ] **Step 1: Change the import**

In `consumptionManager.mjs`, line 5, replace:
```js
import { getEstado, alternar, getSwitchValue, getTodosDispositivos } from './tuyaClient.mjs';
```
with:
```js
import { getEstado, alternar, getSwitchValue, getTodosDispositivos } from './src/api/tuya/client.mjs';
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
git commit -m "refactor: point consumptionManager.mjs to src/api/tuya/client.mjs"
```

---

## Task 4: Update `src/managers/weather.mjs` import

**Files:**
- Modify: `src/managers/weather.mjs:7`

**CRITICAL**: The path changes from `'../../tuyaClient.mjs'` to `'../../api/tuya/client.mjs'`. The number of `../` stays the same (two), but `/api/tuya/` is added in the middle. This was explicitly called out as a risk in the spec.

- [ ] **Step 1: Change the import**

In `src/managers/weather.mjs`, line 7, replace:
```js
import { getTodosDispositivos } from '../../tuyaClient.mjs';
```
with:
```js
import { getTodosDispositivos } from '../../api/tuya/client.mjs';
```

- [ ] **Step 2: Verify**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/src/managers/weather.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add src/managers/weather.mjs
git commit -m "refactor: point weather.mjs to src/api/tuya/client.mjs"
```

---

## Task 5: Update `eslint.config.mjs` lint files list

**Files:**
- Modify: `eslint.config.mjs:26`

- [ ] **Step 1: Change the entry**

In `eslint.config.mjs`, line 26, replace the part:
```js
'tuyaClient.mjs'
```
with:
```js
'src/api/tuya/client.mjs'
```

The full line 26 should now be:
```js
        files: ['*.mjs', 'server.mjs', 'config.mjs', 'src/api/tuya/client.mjs', 'consumptionManager.mjs', 'src/managers/tariff.mjs', 'src/managers/weather.mjs', 'alertManager.mjs'],
```

- [ ] **Step 2: Verify the lint config parses**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/eslint.config.mjs
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add eslint.config.mjs
git commit -m "chore: update eslint config to lint src/api/tuya/client.mjs"
```

---

## Task 6: Update `scripts/backup.sh` FILES array

**Files:**
- Modify: `scripts/backup.sh:20`

Note: The tariff and weather migrations already updated this script in earlier phases to fix `tariffManager.mjs` → `src/managers/tariff.mjs` and `weatherManager.mjs` → `src/managers/weather.mjs`. Now we need the same for `tuyaClient.mjs`.

- [ ] **Step 1: Change the entry**

In `scripts/backup.sh`, find the line:
```bash
    "tuyaClient.mjs"
```
Replace it with:
```bash
    "src/api/tuya/client.mjs"
```

- [ ] **Step 2: Verify the shell script syntax**

Run:
```bash
bash -n /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/scripts/backup.sh
```

Expected: no output (success). `bash -n` parses without executing.

- [ ] **Step 3: Commit**

```bash
git add scripts/backup.sh
git commit -m "chore: update scripts/backup.sh to reference src/api/tuya/client.mjs"
```

---

## Task 7: Verify no module still references `tuyaClient`

**Files:**
- (read-only grep + tests + smoke)

- [ ] **Step 1: Broad grep — lesson from logger spec**

Run:
```bash
grep -rn "tuyaClient" --include="*.mjs" --include="*.js" --include="*.sh" /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/
```

Expected matches:
- `server.mjs:505` — a **commented** line starting with `//` (historical reference). Verify this is the only remaining match.
- `docs/superpowers/specs/2026-06-28-tuya-migration-design.md` — the spec itself (acceptable).
- `.superpowers/sdd/` files — progress ledger and reports (acceptable).

If a match appears in a `.mjs`/`.js`/`.sh` file OTHER than `server.mjs:505`, STOP and report BLOCKED — a consumer still references the old filename.

- [ ] **Step 2: Verify the old file still parses**

Run:
```bash
node --check /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/tuyaClient.mjs
```

Expected: no output. The old file is still valid (it imports the same module with the old path, which still resolves from the root). It just has no consumers anymore.

- [ ] **Step 3: Run the full test suite**

Run:
```bash
cd /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home && npm test
```

Expected: 6 suites pass. **None of them exercises tuyaClient directly** — this is syntactic coverage plus a check that no consumer broke.

- [ ] **Step 4: Smoke-run the server to confirm the module loads**

Run:
```bash
cd /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home
node server.mjs > /tmp/servidor-tuya.log 2>&1 &
SERVER_PID=$!
sleep 3
echo "--- last 15 lines of server log ---"
tail -15 /tmp/servidor-tuya.log
echo "--- MODULE_NOT_FOUND check ---"
grep "MODULE_NOT_FOUND" /tmp/servidor-tuya.log || echo "OK: no MODULE_NOT_FOUND"
kill $SERVER_PID
wait $SERVER_PID 2>/dev/null
```

Expected: listening message ("Server listening on port XXXX" or similar), no `MODULE_NOT_FOUND` for `./tuyaClient.mjs` or `../tuyaClient.mjs`. The Tuya auth call may fail (401, network error) — that is **expected and acceptable**; what matters is the module loaded. A `MODULE_NOT_FOUND` error means a consumer was missed — STOP and report BLOCKED.

---

## Task 8: Delete the old `tuyaClient.mjs`

**Files:**
- Delete: `tuyaClient.mjs` (root)

- [ ] **Step 1: Remove the file**

Run:
```bash
rm /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/tuyaClient.mjs
```

- [ ] **Step 2: Verify the project still runs**

Run:
```bash
cd /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home
timeout 4 node server.mjs 2>&1 | tail -10
```

Expected: listening message, no `MODULE_NOT_FOUND` for `./tuyaClient.mjs` or `../tuyaClient.mjs`.

- [ ] **Step 3: Run the full test suite one more time**

Run:
```bash
cd /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home && npm test
```

Expected: 6 suites pass.

- [ ] **Step 4: Confirm the old file is gone**

Run:
```bash
ls /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/tuyaClient.mjs 2>&1
```

Expected: `No such file or directory`.

- [ ] **Step 5: Final broad grep — only commented reference should remain**

Run:
```bash
grep -rn "tuyaClient" --include="*.mjs" --include="*.js" --include="*.sh" /home/erfilis/Mis\ Fuentes/node.js/tuya.1.1.0/mingo-home/
```

Expected: only `server.mjs:505` (commented line starting with `//`). All other code references should be gone.

- [ ] **Step 6: Commit**

```bash
git add -u tuyaClient.mjs
git commit -m "chore: remove legacy root tuyaClient.mjs after migration to src/api/tuya/"
```

---

## Self-Review Checklist

- [x] Spec coverage: every requirement in `docs/superpowers/specs/2026-06-28-tuya-migration-design.md` maps to a task (Task 1 = new file with corrected import, Tasks 2-4 = imports in server/consumptionManager/weather, Tasks 5-6 = lint/backup, Task 7 = verification, Task 8 = deletion).
- [x] Placeholder scan: no "TBD", "TODO", or vague instructions. Every code step shows the exact replacement.
- [x] Type/signature consistency: same 9 named exports with same signatures. Module-level state preserved.
- [x] Order: new file exists before any consumer switches to it (Task 1 → Tasks 2-4), so the project never has a broken state in git history.
- [x] Final state: only `src/api/tuya/client.mjs` exists; no active consumer references the old path; `npm test` green.
- [x] Consolidated lesson applied (4th time, after logger/tariff/weather):
  - Task 1's brief shows the import **already adjusted** (with `// ADJUSTED:` scaffolding comment for the implementer to verify).
  - Task 1 Step 3 is a load-time test that catches any remaining `ERR_MODULE_NOT_FOUND` before committing.
  - Task 7 grep is broad (`*.mjs`, `*.js`, `*.sh`, whole tree), not narrow like the logger spec's original grep.
  - Task 6 explicitly updates `scripts/backup.sh` (which the tariff phase initially missed and the final review caught — same pattern as weather).
  - Task 4 explicitly addresses the `weather.mjs` import path risk (same number of `../`, new `/api/tuya/` segment in the middle).
- [x] Spec-specific risks addressed:
  - **Path geometry** (4th occurrence): Task 1 Step 3 catches it.
  - **`consumptionManager.mjs` at root**: Task 3 is straightforward (just the path string).
  - **`weather.mjs` import**: Task 4 has explicit verification.
  - **Commented `server.mjs:505`**: Task 7 Step 1 documents the expected single match.
  - **Backup script staleness**: Task 6 handles it.