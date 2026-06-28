import axios from 'axios';
import crypto from 'crypto';
import logger from './src/logging/logger.mjs';

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
            logger.error('Error fetching access token:', error.message);
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
        logger.error(`Tuya API Error (${path}):`, error.message);
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
