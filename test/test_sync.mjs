import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExcluded } from '../scripts/sync.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

assert.equal(isExcluded('node_modules'), true);
assert.equal(isExcluded('public/json'), true);
assert.equal(isExcluded('test'), true);
assert.equal(isExcluded('server.mjs'), false);
assert.equal(isExcluded('public/js/ui/devices.mjs'), false);
assert.equal(isExcluded('npm-debug.log'), true);
assert.equal(isExcluded('session.cookie'), true);
assert.equal(isExcluded('Thumbs.db'), true);

const configPath = path.join(projectRoot, 'tmp-sync-config.json');
const destDir = path.join(projectRoot, 'tmp-sync-dest');

function cleanup() {
    try {
        fs.rmSync(destDir, { recursive: true, force: true });
    } catch {}
    try {
        fs.unlinkSync(configPath);
    } catch {}
}

cleanup();

const e2eConfig = {
    destination: './tmp-sync-dest',
    excludes: [
        'node_modules',
        'public/json',
        'test',
        '.git',
        'logs',
        'sessions',
        'user_prefs',
        'tmp-sync-dest',
        'tmp-sync-config.json'
    ],
    preserveInDestination: []
};

fs.writeFileSync(configPath, JSON.stringify(e2eConfig, null, 2));

try {
    await new Promise((resolve, reject) => {
        const child = spawn('node', ['scripts/sync.mjs'], {
            cwd: projectRoot,
            env: { ...process.env, SYNC_CONFIG: 'tmp-sync-config.json' }
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', data => {
            stdout += data.toString();
        });
        child.stderr.on('data', data => {
            stderr += data.toString();
        });
        child.on('close', code => {
            if (code !== 0) {
                reject(new Error(`sync script exited with code ${code}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`));
            } else {
                resolve({ stdout, stderr });
            }
        });
    });

    assert.equal(fs.existsSync(path.join(destDir, 'node_modules')), false, 'node_modules should not be copied');
    assert.equal(fs.existsSync(path.join(destDir, 'public/json')), false, 'public/json should not be copied');
    assert.equal(fs.existsSync(path.join(destDir, 'server.mjs')), true, 'server.mjs should be copied');
} finally {
    cleanup();
}

console.log('Todos los tests de sync pasaron');
