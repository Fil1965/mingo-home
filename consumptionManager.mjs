import fs from 'fs/promises';
import path from 'path';
import moment from 'moment';
import logger from './src/logging/logger.mjs';
import { getEstado, alternar, getSwitchValue, getTodosDispositivos } from './tuyaClient.mjs';
import { isCurrentHourAmongCheapest, refrescarTarifa, horaIncluidaHoras } from './src/managers/tariff.mjs';

// Re-exportado para compatibilidad con tests existentes
export { horaIncluidaHoras as horaIncluida } from './tariffManager.mjs';

let apagados = {};
let currentHora = null;
let lastPower = 0;
let alertManager = null; // Will be set by server.mjs

// Inyección de dependencias opcional (para tests).
// En producción, se usan los imports originales.
let _deps = null;

export function setDependencies(deps) {
    _deps = deps;
}

function _alternar(...args) {
    return (_deps && _deps.alternar) ? _deps.alternar(...args) : alternar(...args);
}
function _actualizarConsumo(...args) {
    return (_deps && _deps.actualizarConsumo) ? _deps.actualizarConsumo(...args) : actualizarConsumo(...args);
}
function _getTodosDispositivos(...args) {
    return (_deps && _deps.getTodosDispositivos) ? _deps.getTodosDispositivos(...args) : getTodosDispositivos(...args);
}
function _refrescarTarifa(...args) {
    return (_deps && _deps.refrescarTarifa) ? _deps.refrescarTarifa(...args) : refrescarTarifa(...args);
}

export function setAlertManager(manager) {
    alertManager = manager;
}

export function getLastPowerReading() {
    return lastPower;
}

export async function actualizarConsumo(consumo, dirname) {
    const hoy = new Date();
    const dia = moment().format('YYYY-MM-DD');
    const hor = hoy.getHours().toString().padStart(2, '0');
    const min = hoy.getMinutes().toString().padStart(2, '0');
    const jsonDir = path.join(dirname, 'public', 'json');
    const fic = path.join(jsonDir, `${dia}_consumo.json`);

    try {
        await fs.mkdir(jsonDir, { recursive: true });
        let json;
        try {
            const data = await fs.readFile(fic, 'utf8');
            json = JSON.parse(data);
        } catch (err) {
            logger.info('Creando fichero de consumo');
            json = {
                "00": {}, "01": {}, "02": {}, "03": {}, "04": {}, "05": {},
                "06": {}, "07": {}, "08": {}, "09": {}, "10": {}, "11": {},
                "12": {}, "13": {}, "14": {}, "15": {}, "16": {}, "17": {},
                "18": {}, "19": {}, "20": {}, "21": {}, "22": {}, "23": {},
            };
        }

        json[hor][min] = consumo;
        await fs.writeFile(fic, JSON.stringify(json, null, 2), 'utf8');
    } catch (error) {
        logger.error(`Error actualizando consumo:`, error);
    }
}

export async function checkConsumption(state) {
    const { instalacion, medidor, dirname, identificadores } = state;

    // Optimización: Recopilar estados de todos los dispositivos en una sola llamada
    let deviceStates = {};
    try {
        const allStats = await _getTodosDispositivos(state.uid);

        if (allStats.success && (allStats.result.list || Array.isArray(allStats.result))) {
            const list = allStats.result.list || allStats.result;
            list.forEach(d => {
                deviceStates[d.id] = { success: true, result: d.status };
            });
        }
    } catch (e) {
        logger.error("Error obteniendo estados masivos en checkConsumption:", e);
        return;
    }

    // Helper para buscar en el mapa local
    const getEstadoLocal = (id) => {
        return deviceStates[id] || { success: false };
    };

    // Helper para obtener potencia
    const getPowerFromStatus = (status) => {
        let p = 0;
        if (!status || !status.success || !status.result) return 0;
        status.result.forEach(item => {
            if (item.code === 'cur_power') {
                // cur_power is usually in tenths of Watts (e.g., 1000 = 100W)
                p += Number(item.value) || 0;
            } else if (item.code === 'phase_a') {
                // phase_a is a base64 string.
                // Decoding for power: Sincronizado con logic de index.js (bytes 5, 6, 7)
                // Result is in Watts, so we multiply by 10 for consistency with "tenths"
                const dec = Buffer.from(item.value, 'base64');
                if (dec.length >= 8) {
                    const watts = (dec[5] * 1024) + (dec[6] * 256) + dec[7];
                    p += watts * 10;
                }
            }
        });
        return p;
    };

    let consumptionData = {};
    let mainMeterPower = 0; // Tenths of Watt

    // 1. Calcular Medidor Principal ("0" per legacy/user req)
    if (medidor !== null && medidor !== -1) {
        const medidores = typeof medidor === 'string' ? medidor.split(',') : [medidor];

        for (const key of medidores) {
            const medidorConfig = (instalacion.Dispositivos && instalacion.Dispositivos[key]) ? instalacion.Dispositivos[key] : null;
            if (!medidorConfig) continue;
            mainMeterPower += getPowerFromStatus(getEstadoLocal(medidorConfig.Id));
        }
        // Asignamos al ID 0 (General) para continuidad histórica
        consumptionData["0"] = mainMeterPower;
    }

    // 2. Recopilar otros dispositivos con RegistroConsumo=Si
    if (instalacion.Dispositivos) {
        let totalSubMeters = 0;

        // Primero recogemos todos los valores reales
        const rawReadings = {};
        Object.keys(instalacion.Dispositivos).forEach(key => {
            const device = instalacion.Dispositivos[key];
            if (device.RegistroConsumo === 'Si' || device.RegistroConsumo === true) {
                 rawReadings[key] = getPowerFromStatus(getEstadoLocal(device.Id));
            }
        });

        // Aplicamos la salvaguarda de "Headroom" (Margen Disponible)
        // Solo para dispositivos que NO son el medidor general
        const mainMeterIndices = (typeof medidor === 'string' ? medidor.split(',') : [medidor]).map(m => m.toString());

        for (const key of Object.keys(rawReadings)) {
            const device = instalacion.Dispositivos[key];
            let val = rawReadings[key];

            // Si es un medidor general, no se le aplica salvaguarda contra sí mismo
            if (mainMeterIndices.includes(key) || key === "0") {
                consumptionData[key] = val;
                continue;
            }

            // [Safeguard relaxed] Just log potential latency if exceeding headroom
            let sumOthers = 0;
            Object.keys(rawReadings).forEach(k => {
                if (k !== key && !mainMeterIndices.includes(k) && k !== "0") {
                    sumOthers += rawReadings[k];
                }
            });

            let headroom = Math.max(0, mainMeterPower - sumOthers);

            if (mainMeterPower > 0 && val > headroom) {
                // Potential latency, but we allow it for now to catch it in the hourly safeguard
                // We only log if it's significant (e.g. > 10% over headroom or > 100W)
                if (val > headroom * 1.1 || (val - headroom) > 1000) {
                     // logger.info(`[Safeguard] Latencia detectada para ${device.Descripcion}: ${val/10}W vs margen ${headroom/10}W. Se verificará al cerrar la hora.`);
                }
            }

            consumptionData[key] = val;
        }
    }

    // Guardar JSON actualizado
    await _actualizarConsumo(consumptionData, dirname);

    // Actualizar variable global (en W)
    lastPower = Math.round(mainMeterPower / 10);

    // 3. Lógica de Apagado por Exceso de Consumo
    if (mainMeterPower > (Number(instalacion.GENERAL.ConsumoMaximo) || 35000)) { // ConsumoMaximo usually in W? JSON example was 18130 (1.8kW).
                                                                                // Code had: if (consumoTotal > instalacion.GENERAL.ConsumoMaximo)
                                                                                // Before: consumoTotal was raw (tenths). But line 102 said ' W' in log?
                                                                                // Wait, previous code line 98: consumoTotal /= 10. THEN check.
                                                                                // So comparison is in Watts.
        const powerInWatts = mainMeterPower / 10;
        if (powerInWatts > instalacion.GENERAL.ConsumoMaximo) {
            logger.info(`${Math.round(powerInWatts)} W supera el máximo (${instalacion.GENERAL.ConsumoMaximo} W)`);

            if (instalacion.Dispositivos) {
                for (const key of Object.keys(instalacion.Dispositivos)) {
                    const dispositivo = instalacion.Dispositivos[key];
                    if (dispositivo.Apagable && dispositivo.Apagable.toLowerCase() === 'si') {
                        const status = getEstadoLocal(dispositivo.Id);
                        if (status && status.success) {
                            const isOn = getSwitchValue(status, dispositivo.Interruptor || 'switch_1');
                            if (isOn === true) {
                                logger.info(`Apagando ${key} (${dispositivo.Descripcion}) por consumo`);
                                const res = await _alternar(dispositivo.Id, 0, instalacion, identificadores);
                                if (res && res.success) apagados[key] = true;
                            }
                        }
                    }
                }
            }
        }
    } else {
        // Recuperación
        // Recuperación
        for (const key of Object.keys(apagados)) {
            if (apagados[key]) {
                const index = parseInt(key);
                const dispositivo = (instalacion.Dispositivos && instalacion.Dispositivos[index]) ? instalacion.Dispositivos[index] : null;
                if (!dispositivo) continue;

                logger.info(`Encendiendo ${key} (${dispositivo.Descripcion}) - consumo normal`);
                const res = await alternar(dispositivo.Id, 1, instalacion, identificadores);
                if (res && res.success) delete apagados[key];
            }
        }
    }

    // Estequiometria, Tarifa, Humedad (Keep existing logic)
    // Equipos controlados por tarifa: Carga indica el número de hora baratas que debe encenderse
    const nowHora = moment().format('HH');
    if (currentHora !== nowHora) {
        const lastHora = currentHora;
        currentHora = nowHora;
        state.tarifa = await _refrescarTarifa(dirname);

        // Al cambiar de hora, aplicamos salvaguarda a la hora que acaba de terminar
        if (lastHora !== null) {
            applyHourlySafeguard(lastHora, dirname, instalacion, medidor).catch(e => {
                logger.error(`[Safeguard] Error en salvaguarda horaria para ${lastHora}:`, e);
            });
        }

        if (instalacion.Dispositivos) {
            for (const key of Object.keys(instalacion.Dispositivos)) {
                const dispositivo = instalacion.Dispositivos[key];
                if (dispositivo.Carga) {
                    const status = getEstadoLocal(dispositivo.Id);
                    if (status && status.success) {
                        const isOn = getSwitchValue(status, dispositivo.Interruptor || 'switch_1');
                        const isCheapest = isCurrentHourAmongCheapest(state.tarifa, parseInt(dispositivo.Carga), dispositivo.Horas);

                        if (isCheapest && isOn === false) {
                            logger.info(`(${currentHora}) horas baratas para ${key} -- ENCENDEMOS`);
                            await _alternar(dispositivo.Id, 1, instalacion, identificadores);
                        } else if (!isCheapest && isOn === true) {
                            logger.info(`(${currentHora}) NO es barata para ${key} --- APAGAMOS`);
                            await _alternar(dispositivo.Id, 0, instalacion, identificadores);
                        }
                    }
                }
            }
        }
    }

    // Humidity control: devices with Humedad_Maxima and Higrometro
    if (instalacion.Dispositivos) {
        for (const key of Object.keys(instalacion.Dispositivos)) {
            const dispositivo = instalacion.Dispositivos[key];
            if (dispositivo.Humedad_Maxima && dispositivo.Higrometro) {
                try {
                    const nowHourNum = new Date().getHours();
                    const horasCfg = dispositivo.Horas;
                    if (horasCfg && !horaIncluidaHoras(horasCfg, nowHourNum)) {
                        // Si está fuera de horario, comprobamos si está encendido para apagarlo
                        const statusDevice = getEstadoLocal(dispositivo.Id);
                        if (statusDevice && statusDevice.success) {
                            const isOn = getSwitchValue(statusDevice, dispositivo.Interruptor || 'switch_1');
                            if (isOn === true) {
                                logger.info(`Fuera de Horas (${horasCfg}) para ${key} (${dispositivo.Descripcion}) — APAGANDO`);
                                await _alternar(dispositivo.Id, 0, instalacion, identificadores);
                            }
                        }
                        continue;
                    }

                    const higroKey = dispositivo.Higrometro; // higroKey is index string "1" or number
                    const higroIndex = parseInt(higroKey);
                    const higroConfig = instalacion.Dispositivos[higroIndex];

                    if (!higroConfig) {
                        logger.info(`Higrometro ${higroKey} not found for ${key}`);
                        continue;
                    }

                    const statusH = getEstadoLocal(higroConfig.Id);
                    if (!statusH || !statusH.success) {
                        // Silent fail or log sparingly
                        continue;
                    }

                    const humCode = higroConfig.Humedad || 'va_humidity';
                    const humItem = statusH.result.find(r => r.code === humCode);
                    if (!humItem) continue;

                    let humValue = Number(humItem.value);
                    if (higroConfig.HumedadDiv) humValue = humValue / Number(higroConfig.HumedadDiv);

                    const maxHum = Number(dispositivo.Humedad_Maxima);
                    if (isNaN(humValue) || isNaN(maxHum)) continue;

                    const statusDevice = getEstadoLocal(dispositivo.Id);
                    if (!statusDevice || !statusDevice.success) continue;

                    const isOn = getSwitchValue(statusDevice, dispositivo.Interruptor || 'switch_1');

                    if (humValue >= maxHum && isOn !== true) {
                        logger.info(`Humedad ${humValue}% >= ${maxHum}%: encendiendo ${key} (${dispositivo.Descripcion})`);
                        await _alternar(dispositivo.Id, 1, instalacion, identificadores);
                    } else if (humValue < maxHum && isOn === true) {
                        logger.info(`Humedad ${humValue}% < ${maxHum}%: apagando ${key} (${dispositivo.Descripcion})`);
                        await _alternar(dispositivo.Id, 0, instalacion, identificadores);
                    }
                } catch (err) {
                    logger.error(`Error controlando humedad para ${key}:`, err);
                }
            }
        }
    }
}

/**
 * Aplica una corrección a una hora cerrada si la suma de dispositivos excede al medidor general.
 */
export async function applyHourlySafeguard(horaStr, dirname, instalacion, medidorIndicesRaw) {
    const dia = moment().format('YYYY-MM-DD');
    const jsonDir = path.join(dirname, 'public', 'json');
    const fic = path.join(jsonDir, `${dia}_consumo.json`);

    try {
        const data = await fs.readFile(fic, 'utf8');
        const json = JSON.parse(data);
        const hourData = json[horaStr];

        if (!hourData || Object.keys(hourData).length === 0) return;

        // 1. Identificar medidores generales
        const medidorIndices = (typeof medidorIndicesRaw === 'string' ? medidorIndicesRaw.split(',') : [medidorIndicesRaw]).map(m => m.toString());

        // 2. Calcular totales horarios
        let totalGeneral = 0;
        let totalDispositivos = 0;
        const deviceTotals = {};

        // Recorremos cada minuto de la hora
        Object.keys(hourData).forEach(min => {
            const readings = hourData[min];

            // "0" es el medidor general unificado
            totalGeneral += (readings["0"] || 0);

            Object.keys(readings).forEach(devId => {
                // No sumamos el general ni cargamos los medidores que componen el general en el total de dispositivos individuales
                if (devId !== "0" && !medidorIndices.includes(devId)) {
                    const val = readings[devId] || 0;
                    totalDispositivos += val;
                    deviceTotals[devId] = (deviceTotals[devId] || 0) + val;
                }
            });
        });

        // 3. Evaluar discrepancia
        // Permitimos un 2% de margen de error por redondeos o latencia mínima antes de actuar
        if (totalGeneral > 0 && totalDispositivos > (totalGeneral * 1.02)) {
            const ratio = (totalGeneral * 0.98) / totalDispositivos; // Ajustamos al 98% del general para seguridad

            logger.warn(`[Safeguard] Discrepancia horaria detectada en hora ${horaStr}: Dispositivos (${totalDispositivos/10}Wh) > General (${totalGeneral/10}Wh). Aplicando factor de corrección: ${ratio.toFixed(4)}`);

            if (alertManager) {
                alertManager.addAlert(`Corregida discrepancia de consumo en hora ${horaStr}: La suma de dispositivos superaba al medidor general.`, 'safeguard');
            }

            // 4. Aplicar corrección a cada minuto
            Object.keys(hourData).forEach(min => {
                const readings = hourData[min];
                Object.keys(readings).forEach(devId => {
                    if (devId !== "0" && !medidorIndices.includes(devId)) {
                        readings[devId] = Math.round(readings[devId] * ratio);
                    }
                });
            });

            // 5. Guardar cambios
            await fs.writeFile(fic, JSON.stringify(json, null, 2), 'utf8');
            logger.info(`[Safeguard] Hora ${horaStr} corregida y guardada.`);
        } else {
            // logger.info(`[Safeguard] Hora ${horaStr} validada correctamente. (G:${totalGeneral/10}Wh, D:${totalDispositivos/10}Wh)`);
        }

    } catch (err) {
        logger.error(`[Safeguard] Error procesando salvaguarda horaria:`, err);
    }
}
