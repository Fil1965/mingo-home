/**
 * Tests para el helper de escritura atómica con backup.
 *
 * Cubre:
 *  - Escritura atómica: el archivo final nunca está corrupto (no existe fase intermedia)
 *  - Backup: se crea un timestamped backup del contenido previo antes de sobreescribir
 *  - Sin backup si maxBackups = 0
 *  - Limpieza: mantener solo los N backups más recientes
 *  - Crear directorio de backups si no existe
 *  - Error de escritura no deja .tmp huérfano
 */

import assert from 'assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { saveAtomic } from '../src/config/persistence.mjs';

async function mkTmpDir() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mingo-persist-'));
    return dir;
}

async function rmrf(dir) {
    await fs.rm(dir, { recursive: true, force: true });
}

// 1) Escritura atómica: archivo final con contenido válido
{
    const dir = await mkTmpDir();
    try {
        const target = path.join(dir, 'config.json');
        await saveAtomic(target, { version: 1, foo: 'bar' });
        const result = JSON.parse(await fs.readFile(target, 'utf-8'));
        assert.deepStrictEqual(result, { version: 1, foo: 'bar' });
    } finally { await rmrf(dir); }
}

// 2) Backup timestamped del contenido previo
{
    const dir = await mkTmpDir();
    try {
        const target = path.join(dir, 'config.json');
        await fs.writeFile(target, JSON.stringify({ v: 'old' }), 'utf-8');
        await saveAtomic(target, { v: 'new' }, { backupDir: dir });
        const backups = (await fs.readdir(dir)).filter(f => f.startsWith('config.json.backup-'));
        assert.strictEqual(backups.length, 1, `Esperaba 1 backup, encontré ${backups.length}: ${backups.join(',')}`);
        const backupContent = JSON.parse(await fs.readFile(path.join(dir, backups[0]), 'utf-8'));
        assert.deepStrictEqual(backupContent, { v: 'old' });
    } finally { await rmrf(dir); }
}

// 3) Sin backup si maxBackups = 0
{
    const dir = await mkTmpDir();
    try {
        const target = path.join(dir, 'config.json');
        await fs.writeFile(target, JSON.stringify({ v: 'old' }), 'utf-8');
        await saveAtomic(target, { v: 'new' }, { backupDir: dir, maxBackups: 0 });
        const backups = (await fs.readdir(dir)).filter(f => f.includes('backup'));
        assert.strictEqual(backups.length, 0);
    } finally { await rmrf(dir); }
}

// 4) Limpieza: mantener solo N backups más recientes
//    Semántica: cada backup contiene el estado PREVIO al save que lo creó.
//    Por tanto, tras 5 saves de v=1..5, los 3 backups supervivientes son
//    los estados previos a los saves 3, 4, 5, es decir v=2, 3, 4.
{
    const dir = await mkTmpDir();
    try {
        const target = path.join(dir, 'config.json');
        await fs.writeFile(target, JSON.stringify({ v: 0 }), 'utf-8');
        for (let i = 1; i <= 5; i++) {
            await new Promise(r => setTimeout(r, 20));
            await saveAtomic(target, { v: i }, { backupDir: dir, maxBackups: 3 });
        }
        const backups = (await fs.readdir(dir))
            .filter(f => f.startsWith('config.json.backup-'));
        assert.strictEqual(backups.length, 3, `Esperaba 3 backups, encontré ${backups.length}`);

        const contents = await Promise.all(
            backups.map(async name => {
                const c = JSON.parse(await fs.readFile(path.join(dir, name), 'utf-8'));
                return c.v;
            })
        );
        contents.sort((a, b) => a - b);
        assert.deepStrictEqual(contents, [2, 3, 4],
            `Los backups supervivientes deben ser v=2,3,4 (estados previos a saves 3,4,5) pero fueron ${contents.join(',')}`);

        // El archivo final debe tener el último valor escrito (v=5)
        const final = JSON.parse(await fs.readFile(target, 'utf-8'));
        assert.strictEqual(final.v, 5);
    } finally { await rmrf(dir); }
}

// 5) Crear directorio de backups si no existe
{
    const dir = await mkTmpDir();
    try {
        const target = path.join(dir, 'config.json');
        const backupDir = path.join(dir, 'subdir', 'backups');
        await saveAtomic(target, { ok: true }, { backupDir });
        const stat = await fs.stat(backupDir);
        assert.ok(stat.isDirectory());
    } finally { await rmrf(dir); }
}

// 6) Si falla la escritura, no queda .tmp huérfano (el rename es lo último que pasa)
{
    const dir = await mkTmpDir();
    try {
        const target = path.join(dir, 'config.json');
        // Simulamos fallo pasando datos circulares que JSON.stringify no puede serializar
        const circular = {};
        circular.self = circular;
        let threw = false;
        try {
            await saveAtomic(target, circular);
        } catch {
            threw = true;
        }
        assert.ok(threw, 'Debió lanzar error con datos circulares');
        const files = await fs.readdir(dir);
        const tmps = files.filter(f => f.endsWith('.tmp'));
        assert.strictEqual(tmps.length, 0, `No debe quedar .tmp huérfano: ${tmps.join(',')}`);
    } finally { await rmrf(dir); }
}

// 7) Sin archivo previo: escribe sin backup
{
    const dir = await mkTmpDir();
    try {
        const target = path.join(dir, 'config.json');
        await saveAtomic(target, { first: true }, { backupDir: dir });
        const result = JSON.parse(await fs.readFile(target, 'utf-8'));
        assert.deepStrictEqual(result, { first: true });
        const backups = (await fs.readdir(dir)).filter(f => f.includes('backup'));
        assert.strictEqual(backups.length, 0);
    } finally { await rmrf(dir); }
}

// 8) pretty: formato JSON configurable (por defecto pretty)
{
    const dir = await mkTmpDir();
    try {
        const target = path.join(dir, 'config.json');
        await saveAtomic(target, { a: 1, b: 2 });
        const raw = await fs.readFile(target, 'utf-8');
        assert.ok(raw.includes('\n'), 'Por defecto debe ser pretty-printed');
    } finally { await rmrf(dir); }
}

console.log('Todos los tests de saveAtomic pasaron ✅');
process.exit(0);