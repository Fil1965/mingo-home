/**
 * @file Manager for file retention policies
 * @description Handles deletion of old JSON files based on configuration
 */

import fs from 'fs';
import path from 'path';
import logger from './src/logging/logger.mjs';

/**
 * Calculates the cutoff date based on the retention string.
 * @param {string} retention - Retention string (e.g., "15D", "2M", "1A").
 * @returns {Date|null} - The cutoff date or null if format is invalid.
 */
function getCutoffDate(retention) {
    if (!retention) return null;

    const match = retention.match(/^(\d+)([DMA])$/);
    if (!match) {
        logger.warn(`[Retention] Formato de retención inválido: ${retention}. Use D (Días), M (Meses), A (Años).`);
        return null;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];
    const cutoff = new Date();

    // Reset time to start of day for accurate comparison vs file dates (which are just YYYY-MM-DD)
    cutoff.setHours(0, 0, 0, 0);

    switch (unit) {
        case 'D':
            cutoff.setDate(cutoff.getDate() - value);
            break;
        case 'M':
            cutoff.setMonth(cutoff.getMonth() - value);
            break;
        case 'A':
            cutoff.setFullYear(cutoff.getFullYear() - value);
            break;
    }

    return cutoff;
}

/**
 * Manages file retention by deleting files older than the configured period.
 * @param {Object} instalacion - The full installation configuration object.
 * @param {string} baseDir - The base directory of the server (usually __dirname).
 */
export async function manageRetention(instalacion, baseDir) {
    try {
        const retentionConfig = instalacion.GENERAL && instalacion.GENERAL.Retencion;

        if (!retentionConfig) {
            logger.info('[Retention] No hay política de retención configurada (GENERAL.Retencion).');
            return;
        }

        const cutoffDate = getCutoffDate(retentionConfig);
        if (!cutoffDate) return;

        logger.info(`[Retention] Ejecutando limpieza. Retención: ${retentionConfig}. Fecha de corte: ${cutoffDate.toISOString().split('T')[0]}`);

        const jsonDir = path.join(baseDir, 'public', 'json');

        if (!fs.existsSync(jsonDir)) {
            logger.warn(`[Retention] El directorio ${jsonDir} no existe.`);
            return;
        }

        const files = await fs.promises.readdir(jsonDir);
        let deletedCount = 0;

        for (const file of files) {
            // Match format yyyy-mm-dd_*.json
            // Regex: Start with 4 digits, dash, 2 digits, dash, 2 digits, underscore, anything, .json end.
            const match = file.match(/^(\d{4})-(\d{2})-(\d{2})_.*\.json$/);

            if (match) {
                const year = parseInt(match[1], 10);
                const month = parseInt(match[2], 10) - 1; // Months are 0-indexed in JS Date
                const day = parseInt(match[3], 10);

                const fileDate = new Date(year, month, day);

                if (fileDate < cutoffDate) {
                    const filePath = path.join(jsonDir, file);
                    try {
                        await fs.promises.unlink(filePath);
                        logger.info(`[Retention] Archivo eliminado: ${file}`);
                        deletedCount++;
                    } catch (err) {
                        logger.error(`[Retention] Error eliminando ${file}:`, err);
                    }
                }
            }
        }

        logger.info(`[Retention] Limpieza completada. ${deletedCount} archivos eliminados.`);

    } catch (error) {
        logger.error('[Retention] Error crítico durante la ejecución:', error);
    }
}
