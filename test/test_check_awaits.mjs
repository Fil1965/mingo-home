/**
 * Verifica que checkConsumption ESPERA a las llamadas alternar()
 * antes de retornar (bug del forEach(async)).
 *
 * Estrategia: usar setDependencies() para inyectar mocks limpios.
 * Después del test, _deps queda como null y el módulo sigue funcional.
 */

import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Silenciar logger real
import loggerReal from '../logger.mjs';
const origInfo = loggerReal.info.bind(loggerReal);
const origWarn = loggerReal.warn.bind(loggerReal);
const origError = loggerReal.error.bind(loggerReal);
loggerReal.info = () => {};
loggerReal.warn = () => {};
loggerReal.error = () => {};

const consumption = await import('../consumptionManager.mjs');

// --- Stubs ---
let alternarCalls = [];
let alternarStartTimes = [];
let getTodosDispositivosCalls = 0;

const installedDevices = {
    '0': { Id: 'dev-A', Descripcion: 'A', Apagable: 'Si', Interruptor: 'switch_1', RegistroConsumo: 'Si' },
    '1': { Id: 'dev-B', Descripcion: 'B', Apagable: 'Si', Interruptor: 'switch_1', RegistroConsumo: 'Si' },
    '2': { Id: 'dev-C', Descripcion: 'C', Apagable: 'Si', Interruptor: 'switch_1', RegistroConsumo: 'Si' }
};

const fakeStatus = [{ code: 'switch_1', value: true }, { code: 'cur_power', value: 1000 }];

const ALTERNAR_DELAY_MS = 50;

const mocks = {
    alternar: async (deviceId, state) => {
        alternarCalls.push(deviceId);
        alternarStartTimes.push(Date.now());
        await new Promise(r => setTimeout(r, ALTERNAR_DELAY_MS));
        return { success: true };
    },
    actualizarConsumo: async () => { /* no escribe en disco */ },
    getTodosDispositivos: async () => {
        getTodosDispositivosCalls++;
        return {
            success: true,
            result: {
                list: [
                    { id: 'dev-A', status: fakeStatus, online: true },
                    { id: 'dev-B', status: fakeStatus, online: true },
                    { id: 'dev-C', status: fakeStatus, online: true }
                ]
            }
        };
    },
    refrescarTarifa: async () => { return []; }
};

consumption.setDependencies(mocks);

const state = {
    instalacion: {
        GENERAL: { ConsumoMaximo: 50, MedidorGeneral: '0' },
        Dispositivos: installedDevices
    },
    medidor: '0',
    dirname: __dirname,
    identificadores: { 'dev-A': '0', 'dev-B': '1', 'dev-C': '2' },
    uid: 'fake-uid',
    tarifa: null
};

const t0 = Date.now();
await consumption.checkConsumption(state);
const elapsed = Date.now() - t0;

// (a) Las 3 llamadas a alternar deben haberse hecho
assert.strictEqual(alternarCalls.length, 3,
    `Se esperaban 3 llamadas a alternar, hubo ${alternarCalls.length}`);

// (b) Tiempo mínimo: 3 delays secuenciales
//     (con tolerancia para inexactitudes del event loop)
assert.ok(elapsed >= 3 * ALTERNAR_DELAY_MS - 5,
    `checkConsumption retornó en ${elapsed}ms; debería haber esperado al menos ${3 * ALTERNAR_DELAY_MS}ms`);

// (c) Orden de invocación determinista
assert.deepStrictEqual(alternarCalls, ['dev-A', 'dev-B', 'dev-C'],
    `Orden de alternar no determinista: ${alternarCalls.join(',')}`);

// (d) Secuencialidad: el start de la llamada N+1 es >= start de N
for (let i = 1; i < alternarStartTimes.length; i++) {
    const gap = alternarStartTimes[i] - alternarStartTimes[i - 1];
    assert.ok(gap >= -2, // 2ms de tolerancia por resolución del timer
        `Llamada ${i} empezó ${gap}ms antes que la anterior: no fue secuencial`);
}

// (e) Restaurar dependencias y logger
consumption.setDependencies(null);
loggerReal.info = origInfo;
loggerReal.warn = origWarn;
loggerReal.error = origError;

console.log(`Test de orden/espera OK (${alternarCalls.length} alternar secuenciales, ${elapsed}ms total)`);
console.log('Todos los tests pasaron ✅');
process.exit(0);