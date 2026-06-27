# Deployment Sync Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `npm run sync` command that copies only the files needed to run the production server from the development directory to a configurable destination.

**Architecture:** A Node.js ES module script (`scripts/sync.mjs`) reads `sync.config.json` and uses `fs.cpSync` with a filter function to copy files. Excluded patterns are matched by exact name or trailing wildcard. Existing destination files listed in `preserveInDestination` are left untouched.

**Tech Stack:** Node.js native `fs`/`path` modules, ES modules (`.mjs`), `npm` scripts.

---

## File structure

| File | Responsibility |
|------|---------------|
| `scripts/sync.mjs` | Reads config, walks source tree, copies files while filtering. |
| `sync.config.json` | Destination path and exclusion/preservation patterns. |
| `package.json` | Adds the `sync` npm script. |
| `test/test_sync.mjs` | Verifies filter logic and preserves destination config files. |

---

## Task 1: Create `sync.config.json`

**Files:**
- Create: `sync.config.json`

- [ ] **Step 1: Write the config file**

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

- [ ] **Step 2: Validate JSON syntax**

Run: `node --check sync.config.json`
Expected: No output (success).

- [ ] **Step 3: Commit**

```bash
git add sync.config.json
git commit -m "chore: add sync destination configuration"
```

---

## Task 2: Implement `scripts/sync.mjs`

**Files:**
- Create: `scripts/sync.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/test_sync.mjs`:

```javascript
import assert from 'node:assert/strict';
import { isExcluded } from '../scripts/sync.mjs';

assert.equal(isExcluded('node_modules'), true);
assert.equal(isExcluded('public/json'), true);
assert.equal(isExcluded('test'), true);
assert.equal(isExcluded('server.mjs'), false);
assert.equal(isExcluded('public/js/ui/devices.mjs'), false);
assert.equal(isExcluded('npm-debug.log'), true);
assert.equal(isExcluded('session.cookie'), true);
assert.equal(isExcluded('Thumbs.db'), true);

console.log('Todos los tests de sync pasaron ✅');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test_sync.mjs`
Expected: Error — `isExcluded` is not exported or file does not exist.

- [ ] **Step 3: Create minimal skeleton of sync script**

Create `scripts/sync.mjs` with the filter helper and a placeholder main function:

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const configPath = path.join(projectRoot, 'sync.config.json');

function loadConfig() {
    if (!fs.existsSync(configPath)) {
        throw new Error(`No se encontró sync.config.json en ${projectRoot}`);
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

export function isExcluded(name, excludes) {
    return excludes.some(pattern => {
        if (pattern === name) return true;
        if (pattern.endsWith('*') && name.startsWith(pattern.slice(0, -1))) return true;
        return false;
    });
}

function sync(source, destination, config) {
    const { excludes = [], preserveInDestination = [] } = config;

    if (!fs.existsSync(destination)) {
        fs.mkdirSync(destination, { recursive: true });
    }

    let copied = 0;
    let skipped = 0;

    const entries = fs.readdirSync(source, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(source, entry.name);
        const destPath = path.join(destination, entry.name);

        if (isExcluded(entry.name, excludes)) {
            skipped++;
            continue;
        }

        if (entry.isDirectory()) {
            const result = sync(srcPath, destPath, config);
            copied += result.copied;
            skipped += result.skipped;
        } else {
            if (preserveInDestination.includes(entry.name) && fs.existsSync(destPath)) {
                skipped++;
                continue;
            }
            fs.cpSync(srcPath, destPath, { force: true });
            copied++;
        }
    }

    return { copied, skipped };
}

function main() {
    const config = loadConfig();
    const destination = path.resolve(config.destination);
    console.log(`Sincronizando desde ${projectRoot} hacia ${destination}`);
    const { copied, skipped } = sync(projectRoot, destination, config);
    console.log(`Copiados: ${copied}, Omitidos: ${skipped}`);
}

main();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test/test_sync.mjs`
Expected: `Todos los tests de sync pasaron ✅`

- [ ] **Step 5: Run the script against a temp destination to verify end-to-end behavior**

Run:
```bash
node -e "const fs=require('fs'); fs.rmSync('./tmp-sync-dest',{recursive:true,force:true}); const cfg=JSON.parse(fs.readFileSync('sync.config.json','utf8')); cfg.destination='./tmp-sync-dest'; fs.writeFileSync('tmp-sync-config.json',JSON.stringify(cfg,null,2));" && node -e "process.env.SYNC_CONFIG='tmp-sync-config.json'; import('./scripts/sync.mjs')"
```

Wait — the script currently hardcodes `sync.config.json`. We need to make it accept an optional config path first. Add that in the next step.

- [ ] **Step 6: Allow overriding config path via env var**

Modify `scripts/sync.mjs` so `loadConfig` uses `process.env.SYNC_CONFIG` when set:

```javascript
function loadConfig() {
    const configFile = process.env.SYNC_CONFIG || 'sync.config.json';
    const resolved = path.resolve(projectRoot, configFile);
    if (!fs.existsSync(resolved)) {
        throw new Error(`No se encontró el archivo de configuración: ${resolved}`);
    }
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}
```

- [ ] **Step 7: Re-run end-to-end test with temp destination**

Run:
```bash
node -e "const fs=require('fs'); fs.rmSync('./tmp-sync-dest',{recursive:true,force:true}); const cfg=JSON.parse(fs.readFileSync('sync.config.json','utf8')); cfg.destination='./tmp-sync-dest'; fs.writeFileSync('tmp-sync-config.json',JSON.stringify(cfg,null,2));" && SET SYNC_CONFIG=tmp-sync-config.json && node scripts/sync.mjs
```

Expected: Script reports copied/skipped counts. Verify that `tmp-sync-dest/node_modules` and `tmp-sync-dest/public/json` do **not** exist, and `tmp-sync-dest/server.mjs` does exist.

- [ ] **Step 8: Clean up temp files**

Run:
```bash
node -e "const fs=require('fs'); fs.rmSync('./tmp-sync-dest',{recursive:true,force:true}); fs.rmSync('./tmp-sync-config.json',{force:true});"
```

- [ ] **Step 9: Commit**

```bash
git add scripts/sync.mjs test/test_sync.mjs
git commit -m "feat: add deployment sync script"
```

---

## Task 3: Register `npm run sync`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the sync script**

Add this line inside the `"scripts"` object, after `"lint"`:

```json
"sync": "node scripts/sync.mjs"
```

- [ ] **Step 2: Validate package.json syntax**

Run: `node --check package.json`
Expected: No output (success).

- [ ] **Step 3: Verify npm script is registered**

Run: `npm run sync -- --dry-run 2>&1 | head -1`
Expected: Script starts and shows source/destination. (The `--dry-run` flag is not implemented; it will just run. This step checks that npm invokes the script.)

Actually, since we have not implemented dry-run, run a safe verification instead:

Run: `npm run`
Expected: Lists `sync` among available scripts.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: register npm run sync script"
```

---

## Task 4: Verify full sync behavior

**Files:**
- None (verification only)

- [ ] **Step 1: Run existing project tests**

Run: `npm test`
Expected: `Todos los tests pasaron ✅`

- [ ] **Step 2: Run the new sync test**

Run: `node test/test_sync.mjs`
Expected: `Todos los tests de sync pasaron ✅`

- [ ] **Step 3: Inspect the real destination path (read-only check)**

Run:
```bash
node -e "const fs=require('fs'); console.log(fs.existsSync('N:\\\\home\\\\philippe\\\\node.js\\\\tuya.1.1.0') ? 'Destino accesible' : 'Destino NO accesible');"
```

If the destination is not accessible on this machine, do **not** run the real sync yet. The script has been tested against a temporary destination.

- [ ] **Step 4: Commit final verification note (optional)**

If changes were made during verification, commit them; otherwise no additional commit is needed.

---

## Self-review checklist

- [ ] Spec coverage: destination config, excludes, preserve list, no deletion of orphan files, npm script — all have a corresponding task.
- [ ] Placeholder scan: no TBD/TODO/"implement later" in the plan.
- [ ] Type consistency: `isExcluded(name, excludes)` signature used consistently.

## Gaps

- The script currently does not support a `--dry-run` flag. This is acceptable for the first version; add it only if requested.
- The script does not delete orphan files in the destination, matching the spec.
