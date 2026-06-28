/**
 * Persistencia atómica de ficheros JSON.
 *
 * saveAtomic() garantiza:
 *  1. El archivo final NUNCA queda corrupto: se escribe a `<path>.tmp` y se hace
 *     `rename` atómico (en el mismo filesystem el rename es atómico).
 *  2. Antes de sobreescribir, se guarda una copia timestamped en `backupDir`
 *     si está configurado. Los backups se truncan a `maxBackups` (por defecto 10).
 *  3. Si la escritura falla, el `.tmp` huérfano se elimina antes de propagar el error.
 *
 * Pensado para `instalacion.json` y ficheros similares que la app lee en cada
 * arranque: una escritura corrupta impediría arrancar.
 *
 * Uso:
 *   await saveAtomic('/path/config.json', { ... }, { backupDir: '/path/backups' });
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// Counter monotónico por proceso: garantiza orden incluso si dos llamadas
// ocurren en la misma milésima (la resolución del mtime en algunos FS
// tmpfs es ~10ms).
let _sequence = 0;
function nextSeq() {
    _sequence = (_sequence + 1) % 0xffffff;
    return _sequence;
}

/**
 * Escribe `data` (objeto) en `filePath` de forma atómica.
 *
 * @param {string} filePath - ruta absoluta del archivo destino.
 * @param {*} data - datos serializables con JSON.stringify.
 * @param {Object} [options]
 * @param {string} [options.backupDir] - directorio donde guardar backups.
 *   Si no se indica, NO se hace backup.
 * @param {number} [options.maxBackups=10] - número máximo de backups a mantener.
 *   0 desactiva el backup completamente.
 * @param {boolean} [options.pretty=true] - pretty-print con indent=2.
 * @param {string} [options.backupPrefix] - prefijo del nombre del backup.
 *   Por defecto el basename del destino (ej. 'instalacion.json' -> 'instalacion.backup-...').
 * @returns {Promise<void>}
 */
export async function saveAtomic(filePath, data, options = {}) {
    const {
        backupDir = null,
        maxBackups = 10,
        pretty = true,
        backupPrefix = null
    } = options;

    const json = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    const dir = path.dirname(filePath);
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    // 1. Escribir a .tmp en el mismo directorio (requisito para rename atómico)
    try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(tmpPath, json, 'utf-8');
    } catch (err) {
        await fs.unlink(tmpPath).catch(() => {});
        throw err;
    }

    // 2. Backup del archivo previo (si existe y backupDir configurado)
    if (backupDir && maxBackups > 0) {
        // Asegurar que el directorio de backups existe siempre que se pida.
        // Se hace antes del readFile porque si el archivo previo no existe
        // queremos que backupDir sí quede creado.
        try {
            await fs.mkdir(backupDir, { recursive: true });
        } catch (err) {
            await fs.unlink(tmpPath).catch(() => {});
            throw err;
        }

        try {
            const previous = await fs.readFile(filePath, 'utf-8');
            const baseName = backupPrefix || path.basename(filePath);
            // Sufijo: timestamp + sequence (per-process) + 4 hex random
            // La sequence evita empates cuando el mtime no distingue llamadas
            // muy rápidas en algunos filesystems.
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23); // YYYY-MM-DDTHH-MM-SS-mmm
            const seq = nextSeq().toString(16).padStart(6, '0');
            const rand = crypto.randomBytes(2).toString('hex');
            const backupName = `${baseName}.backup-${ts}-${seq}-${rand}`;
            await fs.writeFile(path.join(backupDir, backupName), previous, 'utf-8');

            // Truncar backups antiguos
            await truncateBackups(backupDir, baseName, maxBackups);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                // Si falla el backup, limpiamos tmp y propagamos
                await fs.unlink(tmpPath).catch(() => {});
                throw err;
            }
            // ENOENT: archivo previo no existe, no hay nada que respaldar
        }
    }

    // 3. Rename atómico .tmp -> final
    try {
        await fs.rename(tmpPath, filePath);
    } catch (err) {
        await fs.unlink(tmpPath).catch(() => {});
        throw err;
    }
}

/**
 * Conserva solo los últimos `maxBackups` archivos que empiezan por `baseName`.
 * Como el nombre incluye sequence (monotónico por proceso) y timestamp con
 * milisegundos, el orden lexicográfico refleja el orden de creación.
 */
async function truncateBackups(backupDir, baseName, maxBackups) {
    const entries = await fs.readdir(backupDir);
    const backupNames = entries
        .filter(f => f.startsWith(`${baseName}.backup-`))
        .sort(); // lexicográfico = cronológico con nuestro naming

    if (backupNames.length <= maxBackups) return;

    const toDelete = backupNames.slice(0, backupNames.length - maxBackups);
    await Promise.all(
        toDelete.map(name => fs.unlink(path.join(backupDir, name)).catch(() => {}))
    );
}