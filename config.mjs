import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import logger from './logger.mjs';
import { saveAtomic } from './src/config/persistence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readFileAsync = promisify(fs.readFile);
const instalacion_ini = 'instalacion.ini';

/**
 * Carga la configuración desde instalacion.json.
 * @returns {Promise<Object>} Configuración normalizada
 */
export async function loadConfig() {
    const configPath = path.join(__dirname, 'instalacion.json');
    try {
        const data = await readFileAsync(configPath, 'utf-8');
        const config = JSON.parse(data);
        const medidorId = config.GENERAL.MedidorGeneral;
        const usuarios = config.USUARIOS || {};

        logger.info(`Leyendo configuración desde ${configPath} ...`);

        return {
            instalacion: config,
            medidor: medidorId,
            serverHost: config.SERVER?.Host || '0.0.0.0',
            serverPort: config.SERVER?.Port || 3000,
            webHook: config.SERVER?.WebHook || null,
            ngrokToken: config.SERVER?.ngrokToken || null,
            ngrokDomain: config.SERVER?.ngrokDomain || null,
            apiKey: config.SERVER?.ApiKey || null,
            tuyaBaseUrl: config.TUYA?.baseUrl || 'https://openapi.tuyaeu.com',
            tuyaAccessKey: config.TUYA?.accessKey,
            tuyaSecretKey: config.TUYA?.secretKey,
            corsOrigins: parseCorsOrigins(config.SERVER?.CorsOrigins),
            usuarios,
            __dirname
        };
    } catch (error) {
        logger.error(`Error cargando la configuración desde ${configPath}:`, error.message);
        throw error;
    }
}

/**
 * Parsea la lista de orígenes CORS permitidos desde una cadena separada por comas.
 * Devuelve un Set (o null si no se configuró) que la middleware de CORS consulta.
 */
function parseCorsOrigins(raw) {
    if (!raw) return null;
    return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
}

/**
 * Guarda la configuración en instalacion.json de forma atómica.
 *
 * - Escribe primero a `<path>.<pid>.<ts>.tmp` en el mismo directorio.
 * - Hace `rename` atómico a la ruta final.
 * - Antes de sobreescribir, deja una copia timestamped en `instalacion.backups/`
 *   con un máximo de 10 backups (configurable).
 *
 * Si NODE_ENV=production y la escritura falla, se propaga el error para que
 * el caller pueda notificar al usuario.
 *
 * @param {Object} configObject Configuración completa a guardar
 * @returns {Promise<void>}
 */
export async function saveConfig(configObject) {
    const configPath = path.join(__dirname, 'instalacion.json');
    const backupDir = path.join(__dirname, 'instalacion.backups');
    try {
        await saveAtomic(configPath, configObject, { backupDir, maxBackups: 10 });
        logger.info('Configuración guardada (atomic) en instalacion.json');
    } catch (error) {
        logger.error('Error guardando la configuración:', error);
        throw error;
    }
}
