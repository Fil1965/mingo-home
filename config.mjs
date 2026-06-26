import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import logger from './logger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readFileAsync = promisify(fs.readFile);
const instalacion_ini = 'instalacion.ini';

/**
 * Loads configuration from instalacion.ini
 * @returns {Promise<Object>} Configuration object
 */
export async function loadConfig() {
    try {
        const configPath = path.join(__dirname, 'instalacion.json');
        const data = await readFileAsync(configPath, 'utf-8');
        const config = JSON.parse(data);
        const medidorId = config.GENERAL.MedidorGeneral;
        const usuarios = config.USUARIOS || {};

        logger.info('Leyendo configuración (JSON) ...');

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
            usuarios,
            __dirname
        };
    } catch (error) {
        logger.error('Error cargando la configuración:', error);
        throw error;
    }
}

/**
 * Saves configuration to instalacion.json
 * @param {Object} configObject Configuration object to save
 * @returns {Promise<void>}
 */
export async function saveConfig(configObject) {
    try {
        const configPath = path.join(__dirname, 'instalacion.json');
        const data = JSON.stringify(configObject, null, 2);
        await fs.promises.writeFile(configPath, data, 'utf-8');
        logger.info('Configuración guardada en instalacion.json');
    } catch (error) {
        logger.error('Error guardando la configuración:', error);
        throw error;
    }
}
