/**
 * @file Server for Tuya smart device management (Refactored)
 * @description Express server that manages Tuya smart devices and electricity rates
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { promises as fsp } from 'fs';
import ngrok from '@ngrok/ngrok';
import session from 'express-session';
import sessionFileStore from 'session-file-store';

import logger from './logger.mjs';
import { loadConfig, saveConfig } from './config.mjs';
import { initTuya, getEstado, getInfo, getTodosDispositivos, alternar, API_PATHS, makeRequest, detectUid } from './tuyaClient.mjs';
import { refrescarTarifa, getCurrentTarifaValue, isCurrentHourAmongCheapest } from './tariffManager.mjs';
import { fetchWeather } from './weatherManager.mjs';
import { manageRetention } from './retentionManager.mjs';
import AlertManager from './alertManager.mjs';
import { setAlertManager, checkConsumption, getLastPowerReading } from './consumptionManager.mjs';

/**
 * Basic authentication middleware
 */
function basicAuth(users) {
    return function (req, res, next) {
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Basic ')) {
            res.set('WWW-Authenticate', 'Basic realm="Acceso restringido"');
            return res.status(401).send('Autenticación requerida');
        }
        const [user, pass] = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
        if (users[user] && users[user] === pass) {
            return next();
        }
        res.set('WWW-Authenticate', 'Basic realm="Acceso restringido"');
        return res.status(401).send('Credenciales incorrectas');
    };
}

async function startServer() {
    try {
        const config = await loadConfig();
        const {
            instalacion, medidor, serverHost, serverPort, webHook, ngrokToken,
            ngrokDomain, usuarios, __dirname
        } = config;

        initTuya(instalacion.TUYA);

        const alertManager = new AlertManager(__dirname);
        const adminList = (instalacion.GENERAL.administradores || '').split(',').map(u => u.trim()).filter(u => u !== '');
        await alertManager.load(adminList);
        setAlertManager(alertManager);

        const state = {
            instalacion,
            medidor,
            dirname: __dirname,
            identificadores: {},
            lastOfflineCheck: new Map(), // Cache for verifying offline devices
            tarifa: null,
            uid: null,
            alertManager
        };

        // Create reverse identifier map
        if (state.instalacion.Dispositivos) {
            Object.keys(state.instalacion.Dispositivos).forEach(key => {
                const dev = state.instalacion.Dispositivos[key];
                if (dev.Id) state.identificadores[dev.Id] = key;
            });
        }

        // Fetch weather immediately and then schedule for every hour on the hour
        const scheduleNextWeather = (isRetry = false) => {
            const now = new Date();
            let delay;
            let nextRunLabel;

            if (isRetry) {
                delay = 300000; // 5 minutos para reintento
                const nextRun = new Date(now.getTime() + delay);
                nextRunLabel = `(reintento) a las ${nextRun.getHours()}:${nextRun.getMinutes().toString().padStart(2, '0')}`;
            } else {
                const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 500);
                delay = nextHour.getTime() - now.getTime();
                nextRunLabel = `a las ${nextHour.getHours()}:00`;
            }

            logger.info(`[Weather] Próxima actualización programada ${nextRunLabel}`);

            setTimeout(async () => {
                try {
                    const success = await fetchWeather(state);
                    scheduleNextWeather(!success);
                } catch (e) {
                    logger.error('[Weather] Error during scheduled fetch:', e);
                    scheduleNextWeather(true);
                }
            }, delay);
        };

        // Initialize background tasks without blocking server startup
        const detectAndInit = async () => {
            try {
                // 1. Detect UID ASAP to optimize following cloud queries
                const uid = await detectUid(state.identificadores);
                if (uid) {
                    state.uid = uid;
                    logger.info(`[Startup] UID de Tuya detectado: ${uid}`);
                }
            } catch (e) {
                logger.warn('[Startup] Fallo al detectar UID:', e.message);
            }

            // 2. Schedule Consumption check
            setTimeout(async () => {
                try {
                    await checkConsumption(state);
                } catch (e) {
                    logger.error('[Startup] Error en primer checkConsumption:', e);
                }
            }, 0);

            // 3. Schedule Weather check
            setTimeout(async () => {
                try {
                    const success = await fetchWeather(state);
                    scheduleNextWeather(!success);
                } catch (e) {
                    logger.error('[Startup] Error en primer fetchWeather:', e);
                    scheduleNextWeather(true);
                }
            }, 0);
        };

        detectAndInit(); // Fire and forget

        setInterval(() => checkConsumption(state), 60000);

        // Retention Policy: Run on startup and every 24 hours
        manageRetention(state.instalacion, state.dirname);
        setInterval(() => manageRetention(state.instalacion, state.dirname), 24 * 60 * 60 * 1000);

        const app = express();

        // Body parsers
        app.use(express.urlencoded({ extended: true }));
        app.use(express.json());

        // Custom CORS Middleware
        app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-api-key, Authorization');
            res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
            if (req.method === 'OPTIONS') {
                return res.sendStatus(200);
            }
            next();
        });

        // Static files (served without auth)
        app.use(express.static(path.join(__dirname, 'public')));
        app.use('/jquery', express.static(path.join(__dirname, 'node_modules/jquery/dist/')));
        app.use('/bootstrap', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/')));
        app.use('/bootstrap-icons', express.static(path.join(__dirname, 'node_modules/bootstrap-icons/')));
        app.use('/chart.js', express.static(path.join(__dirname, 'node_modules/chart.js/dist/')));
        app.use('/moment', express.static(path.join(__dirname, 'node_modules/moment/min/')));

        // Session middleware (persistent store on disk to survive restarts)
        const sessionSecret = (instalacion && instalacion.SERVER && instalacion.SERVER.SessionSecret) || process.env.SESSION_SECRET || 'cambiar-esta-clave';
        const FileStore = sessionFileStore(session);
        const sessionsDir = path.join(__dirname, 'sessions');
        let useFileStore = true;
        try {
            fs.mkdirSync(sessionsDir, { recursive: true });
            // verify writability
            fs.accessSync(sessionsDir, fs.constants.W_OK);
        } catch (e) {
            useFileStore = false;
            logger.warn('[session-file-store] sessions dir not writable:', sessionsDir, '-', e.message);
            logger.warn('[session-file-store] Falling back to in-memory session store. To fix, run:');
            logger.warn('  sudo mkdir -p ' + sessionsDir + ' && sudo chown $(whoami) ' + sessionsDir);
        }

        const sessionOptions = {
            secret: sessionSecret,
            resave: false,
            saveUninitialized: false,
            cookie: { maxAge: 24 * 60 * 60 * 1000 }
        };

        if (useFileStore) {
            sessionOptions.store = new FileStore({
                path: sessionsDir,
                retries: 0
            });
        }

        app.use(session(sessionOptions));



        // Simple session-based auth middleware for protecting API routes
        function requireAuth(req, res, next) {
            // Check for API Key first (for ESP32 and other automated clients)
            const apiKey = req.headers['x-api-key'];
            if (apiKey && apiKey === config.apiKey) {
                return next();
            }

            if (req.session && req.session.authenticated) return next();
            // JSON requests get 401, normal requests redirect to login page
            if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('application/json') !== -1)) {
                return res.status(401).json({ error: 'Autenticación requerida' });
            }
            return res.redirect('/login');
        }

        // Public time endpoint for ESP32 synchronization
        app.get('/time', (req, res) => {
            const now = new Date();
            res.json({
                timestamp: Math.floor(now.getTime() / 1000),
                formatted: now.toLocaleString('es-ES'),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
            });
        });

        // Public health check endpoint for restart monitoring
        app.get('/health', (req, res) => {
            res.json({ status: 'ok' });
        });

        // Endpoint for About section
        app.get('/about', (req, res) => {
            try {
                const packageJsonPath = path.join(__dirname, 'package.json');
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                res.json({
                    name: packageJson.name,
                    version: packageJson.version,
                    description: packageJson.description,
                    author: packageJson.author
                });
            } catch (error) {
                logger.error('Error reading package.json:', error);
                res.status(500).json({ error: 'Error retrieving application info' });
            }
        });

        // API Routes
        app.get('/instalacion.json', requireAuth, (req, res) => {
            const adminList = (state.instalacion.GENERAL.administradores || '').split(',').map(u => u.trim());
            const isAdmin = adminList.includes(req.session.user);
            if (isAdmin) {
                res.json(state.instalacion);
            } else {
                // Non-admins only get the title to satisfy basic UI needs
                res.json({ GENERAL: { Titulo: state.instalacion.GENERAL.Titulo } });
            }
        });

        app.post('/server/restart', requireAuth, (req, res) => {
            const adminList = (state.instalacion.GENERAL.administradores || '').split(',').map(u => u.trim());
            const isAdmin = adminList.includes(req.session.user);
            if (!isAdmin) return res.status(403).json({ error: 'Acceso denegado' });

            logger.info(`[Server] Restart requested by ${req.session.user}`);
            res.json({ success: true, message: 'Reiniciando servidor...' });

            setTimeout(() => {
                process.exit(0);
            }, 500);
        });

        app.post('/config/valor', requireAuth, async (req, res) => {
            const adminList = (state.instalacion.GENERAL.administradores || '').split(',').map(u => u.trim());
            const isAdmin = adminList.includes(req.session.user);
            if (!isAdmin) return res.status(403).json({ error: 'Acceso denegado' });

            const { section, key, value } = req.body;
            if (!section || !key || value === undefined) return res.status(400).json({ error: 'Parámetros insuficientes' });

            // Solo permitimos editar ciertos campos por seguridad
            const allowed = (section === 'GENERAL' && (key === 'Titulo' || key === 'Retencion' || key === 'ConsumoMaximo' || key === 'PrecioMinimo' || key === 'MedidorGeneral' || key === 'administradores' || key === 'Coordenadas' || key === 'AEMETApiKey' || key === 'AEMETEstacion' || key === 'OpenWeatherApiKey' || key === 'PrioridadTiempo' || key === 'CarpetaJson')) || (!isNaN(section) && (key === 'Descripcion' || key === 'Apagable' || key === 'MostrarGrafico' || key === 'RegistroConsumo' || key === 'Carga' || key === 'Consumo' || key === 'Horas' || key === 'Humedad_Maxima' || key === 'Icon' || key === 'IconOn' || key === 'IconOff' || key === 'Esp32Pag' || key === 'Esp32Tip' || key === 'Esp32Dsp')) || (section === 'USUARIOS') || (section === 'SERVER') || (section === 'TUYA');
            if (!allowed) return res.status(403).json({ error: 'Campo no editable' });

            // Validación específica para Apagable
            if (key === 'Apagable' && !['Si', 'No'].includes(value)) {
                return res.status(400).json({ error: 'El valor de Apagable debe ser "Si" o "No"' });
            }

            // Validación para campos numéricos positivos (ConsumoMaximo, PrecioMinimo, Consumo)
            if (key === 'ConsumoMaximo' || key === 'PrecioMinimo' || key === 'Consumo') {
                const val = parseInt(value);
                if (isNaN(val) || val <= 0) {
                    return res.status(400).json({ error: `${key} debe ser un entero positivo` });
                }
            }

            // Validación para Humedad_Maxima (0-100)
            if (key === 'Humedad_Maxima') {
                const val = parseInt(value);
                if (isNaN(val) || val < 0 || val > 100) {
                    return res.status(400).json({ error: 'Humedad_Maxima debe ser un entero entre 0 y 100' });
                }
            }

            // Validación para Carga (0-24)
            if (key === 'Carga') {
                const val = parseInt(value);
                if (isNaN(val) || val < 0 || val > 24) {
                    return res.status(400).json({ error: 'Carga debe ser un entero entre 0 y 24' });
                }
            }

            // Validación para MedidorGeneral
            if (key === 'MedidorGeneral') {
                const val = parseInt(value);
                if (isNaN(val) || val < 0 || !state.instalacion.Dispositivos[val]) {
                    return res.status(400).json({ error: 'MedidorGeneral debe ser un ID de dispositivo válido' });
                }
            }

            // Validación para Horas (pueden ser horas 0-24 separadas por comas o rangos 0-24)
            if (key === 'Horas' && value.trim() !== '') {
                const parts = value.split(',').map(p => p.trim());
                for (const part of parts) {
                    if (part.includes('-')) {
                        const range = part.split('-').map(r => r.trim());
                        if (range.length !== 2) return res.status(400).json({ error: 'Formato de rango no válido en Horas' });
                        const h1 = parseInt(range[0]);
                        const h2 = parseInt(range[1]);
                        if (isNaN(h1) || h1 < 0 || h1 > 24 || isNaN(h2) || h2 < 0 || h2 > 24) {
                            return res.status(400).json({ error: 'Las horas en los rangos deben estar entre 0 y 24' });
                        }
                    } else {
                        const h = parseInt(part);
                        if (isNaN(h) || h < 0 || h > 24) {
                            return res.status(400).json({ error: 'Las horas deben estar entre 0 y 24' });
                        }
                    }
                }
            }

            // Validación para Esp32Pag
            if (key === 'Esp32Pag' && value.trim() !== '') {
                const val = parseInt(value);
                if (isNaN(val) || val <= 0) {
                    return res.status(400).json({ error: 'Esp32Pag debe ser un entero superior a 0' });
                }
                // Check uniqueness
                const exists = Object.keys(state.instalacion.Dispositivos).some(k => {
                   if (k === section) return false;
                   return state.instalacion.Dispositivos[k].Esp32Pag == val;
                });
                if (exists) {
                    return res.status(400).json({ error: 'Esp32Pag ya está en uso por otro dispositivo' });
                }
            }

            // Validación para Esp32Tip
            if (key === 'Esp32Tip' && value.trim() !== '') {
                const validTips = ['Consumo', 'Clima', 'Luz', 'Enchufe'];
                if (!validTips.includes(value)) {
                    return res.status(400).json({ error: 'Esp32Tip inválido' });
                }
            }

            // Validación para Esp32Dsp
            if (key === 'Esp32Dsp' && value.trim() !== '') {
                const val = parseInt(value);
                if (isNaN(val) || val <= 0) {
                    return res.status(400).json({ error: 'Esp32Dsp debe ser un entero superior a 0' });
                }
            }

            let targetSection;
            if (['GENERAL', 'SERVER', 'USUARIOS', 'TUYA'].includes(section)) {
                targetSection = state.instalacion[section];
            } else {
                targetSection = state.instalacion.Dispositivos[section];
            }

            if (targetSection) {
                // Si el valor es una cadena vacía y es un parámetro de dispositivo, eliminamos el parámetro
                if (!['GENERAL', 'SERVER', 'USUARIOS', 'TUYA'].includes(section) && (key === 'Icon' || key === 'IconOn' || key === 'IconOff' || key === 'Esp32Pag' || key === 'Esp32Tip' || key === 'Esp32Dsp') && value.trim() === '') {
                    delete targetSection[key];
                    logger.info(`Configuración [${section}].${key} eliminada (valor vacío)`);
                } else {
                    targetSection[key] = value;
                    logger.info(`Configuración [${section}].${key} actualizada a: ${value}`);
                }

                try {
                    await saveConfig(state.instalacion);
                    res.json({ success: true });
                } catch (e) {
                    res.status(500).json({ error: 'Error al salvar la configuración' });
                }
            } else {
                res.status(404).json({ error: 'Sección no encontrada' });
            }
        });

        app.post('/config/usuario/añadir', requireAuth, async (req, res) => {
            const adminList = (state.instalacion.GENERAL.administradores || '').split(',').map(u => u.trim());
            const isAdmin = adminList.includes(req.session.user);
            if (!isAdmin) return res.status(403).json({ error: 'Acceso denegado' });

            const { usuario, password } = req.body;
            if (!usuario || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

            if (state.instalacion.USUARIOS[usuario]) {
                return res.status(400).json({ error: 'El usuario ya existe' });
            }

            state.instalacion.USUARIOS[usuario] = password;
            try {
                await saveConfig(state.instalacion);
                logger.info(`Usuario añadido: ${usuario}`);
                res.json({ success: true });
            } catch (e) {
                res.status(500).json({ error: 'Error al salvar la configuración' });
            }
        });

        app.post('/config/usuario/eliminar', requireAuth, async (req, res) => {
            const adminList = (state.instalacion.GENERAL.administradores || '').split(',').map(u => u.trim());
            const isAdmin = adminList.includes(req.session.user);
            if (!isAdmin) return res.status(403).json({ error: 'Acceso denegado' });

            const { usuario } = req.body;
            if (!usuario) return res.status(400).json({ error: 'Usuario requerido' });

            if (!state.instalacion.USUARIOS[usuario]) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }

            // No permitir auto-eliminación por seguridad si es el único admin?
            // El usuario no lo ha pedido, así que procedemos normal.
            delete state.instalacion.USUARIOS[usuario];

            try {
                await saveConfig(state.instalacion);
                logger.info(`Usuario eliminado: ${usuario}`);
                res.json({ success: true });
            } catch (e) {
                res.status(500).json({ error: 'Error al salvar la configuración' });
            }
        });

        app.get('/tuya/info/:deviceId', requireAuth, async (req, res) => {
            const adminList = (state.instalacion.GENERAL.administradores || '').split(',').map(u => u.trim());
            const isAdmin = adminList.includes(req.session.user);
            if (!isAdmin) return res.status(403).json({ error: 'Acceso denegado' });

            const deviceId = req.params.deviceId;
            try {
                const info = await getInfo(deviceId);
                res.json(info);
            } catch (e) {
                logger.error('Error al obtener info de Tuya:', e);
                res.status(500).json({ error: 'Error al consultar la nube de Tuya' });
            }
        });

        app.get('/tuya/todos', requireAuth, async (req, res) => {
            const adminList = (state.instalacion.GENERAL.administradores || '').split(',').map(u => u.trim());
            const isAdmin = adminList.includes(req.session.user);
            if (!isAdmin) return res.status(403).json({ error: 'Acceso denegado' });

            try {
                // Optimización: Usamos el UID cacheado si existe
                let uid = state.uid;

                if (!uid) {
                    const existingIds = Object.keys(state.identificadores);
                    // Iteramos para encontrar un UID válido
                    for (const devId of existingIds) {
                        try {
                            const devInfo = await getInfo(devId);
                            if (devInfo.success && devInfo.result && devInfo.result.uid) {
                                uid = devInfo.result.uid;
                                state.uid = uid; // Cachear para otros usos
                                logger.info(`UID de Tuya detectado: ${uid} (desde ${devId})`);
                                break;
                            }
                        } catch (ignore) { }
                    }
                }

                const info = await getTodosDispositivos(uid);

                // Normalizamos la respuesta para el frontend (siempre result.list)
                if (info.success && Array.isArray(info.result)) {
                    info.result = { list: info.result };
                }

                res.json(info);
            } catch (e) {
                logger.error('Error al obtener todos los dispositivos de Tuya:', e);
                res.status(500).json({ error: 'Error al consultar la nube de Tuya' });
            }
        });

        app.get('/tuya/functions/:id', requireAuth, async (req, res) => {
            try {
                // We need to access makeRequest and API_PATHS from this scope,
                // but those are not exported directly as an object we can just use with custom paths easily
                // unless we import makeRequest.
                // actually server.mjs imports { ... getInfo ... } but probably not makeRequest.
                // Re-checking imports...
                // server.mjs imports:
                // import { ..., getInfo, getTodosDispositivos, alternar, makeRequest, API_PATHS } from './tuyaClient.mjs';
                // Wait, I need to check if makeRequest and API_PATHS are imported.
                // If not, I should add them to the import list.

                const result = await makeRequest(API_PATHS.functions(req.params.id), 'GET');
                res.json(result);
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        app.post('/config/dispositivo/add', requireAuth, async (req, res) => {
            logger.info('Solicitud recibida para añadir dispositivo:', req.body);
            const adminList = (state.instalacion.GENERAL.administradores || '').split(',').map(u => u.trim());
            const isAdmin = adminList.includes(req.session.user);
            if (!isAdmin) return res.status(403).json({ error: 'Acceso denegado' });

            const { id, descripcion, protocolo } = req.body;
            if (!id || !descripcion || !protocolo) return res.status(400).json({ error: 'Parámetros insuficientes' });

            // Verificar si el ID ya existe
            const exists = Object.values(state.instalacion.Dispositivos).some(d => d.Id === id);
            if (exists) return res.status(400).json({ error: 'El dispositivo ya está configurado' });

            // Encontrar el siguiente índice numérico
            let nextIndex = 0;
            // Iterate until we find a gap or end
            while (state.instalacion.Dispositivos[nextIndex]) {
                nextIndex++;
            }

            const configDevice = {
                Descripcion: descripcion,
                Protocolo: protocolo,
                Id: id,
                Apagable: 'No' // Default value
            };

            // Auto-detect capabilities from Tuya Cloud
            try {
                const devInfo = await getInfo(id);
                if (devInfo.success && devInfo.result) {

                    if (Array.isArray(devInfo.result.status)) {
                        const status = devInfo.result.status;
                        for (const s of status) {
                            const code = s.code;
                            if (code.startsWith('switch')) {
                                configDevice.Interruptor = code;
                            } else if (code.includes('cur_power')) {
                                configDevice.Potencia = 'cur_power';
                            } else if (code.includes('cur_current')) {
                                configDevice.Corriente = 'cur_current';
                            } else if (code.includes('cur_voltage')) {
                                configDevice.Voltaje = 'cur_voltage';
                            } else if (code.includes('va_temperature')) {
                                configDevice.Temperatura = 'va_temperature';
                                configDevice.TemperaturaDiv = '10';
                            } else if (code.includes('va_humidity')) {
                                configDevice.Humedad = 'va_humidity';
                            }
                        }
                    }

                    // Fallback using functions definition (useful if status is empty)
                    if (Array.isArray(devInfo.result.functions)) {
                        const funcs = devInfo.result.functions;
                        for (const f of funcs) {
                            const code = f.code;
                            // Solo sobrescribimos si no se ha configurado ya
                            if (code.startsWith('switch') && !configDevice.Interruptor) {
                                configDevice.Interruptor = code;
                            } else if (code.includes('cur_power') && !configDevice.Potencia) {
                                configDevice.Potencia = code;
                            } else if (code.includes('cur_current') && !configDevice.Corriente) {
                                configDevice.Corriente = code;
                            } else if (code.includes('cur_voltage') && !configDevice.Voltaje) {
                                configDevice.Voltaje = code;
                            } else if (code.includes('va_temperature') && !configDevice.Temperatura) {
                                configDevice.Temperatura = code;
                                configDevice.TemperaturaDiv = '10';
                            } else if (code.includes('va_humidity') && !configDevice.Humedad) {
                                configDevice.Humedad = code;
                            }
                        }
                    }
                }
            } catch (err) {
                logger.error('Error auto-detecting device capabilities:', err);
                // Continue adding the device even if auto-detection fails
            }

            state.instalacion.Dispositivos[nextIndex] = configDevice;

            // Intentar añadir campos comunes si es posible
            // Por ahora solo lo básico como pide el usuario.

            try {
                await saveConfig(state.instalacion);
                // Actualizar identificadores en memoria
                state.identificadores[id] = nextIndex.toString();
                logger.info(`Nuevo dispositivo añadido [${nextIndex}]: ${descripcion} (${id})`);
                res.json({ success: true, section: nextIndex });
            } catch (e) {
                res.status(500).json({ error: 'Error al salvar la configuración' });
            }
        });

        // Helper to update the last modification timestamp for a specific ESP32
        const updateMingoTimestamp = async (dsp) => {
            if (!dsp) return;
            const now = Date.now().toString();
            state.instalacion.GENERAL[`Timestamp_${dsp}`] = now;
            try {
                await saveConfig(state.instalacion);
            } catch (e) {
                logger.error(`Error saving timestamp for DSP ${dsp}:`, e);
            }
        };

        // endpoint para comprobar sesión sin redirección (útil para AJAX)
        app.get('/session', (req, res) => {
            if (req.session && req.session.authenticated) {
                const adminList = (state.instalacion.GENERAL.administradores || '').split(',').map(u => u.trim());
                const isAdmin = adminList.includes(req.session.user);
                return res.json({ authenticated: true, user: req.session.user, isAdmin: isAdmin });
            }
            return res.status(401).json({ authenticated: false });
        });

        // Login routes
        app.get('/login', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'login.html'));
        });

        app.post('/login', (req, res) => {
            const user = req.body.user || '';
            const pass = req.body.pass || '';
            if (usuarios[user] && usuarios[user] === pass) {
                req.session.authenticated = true;
                req.session.user = user;
                if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('application/json') !== -1)) {
                    return res.json({ success: true });
                }
                return res.redirect('/');
            }
            if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('application/json') !== -1)) {
                return res.status(401).json({ success: false, msg: 'Credenciales incorrectas' });
            }
            return res.status(401).send('Credenciales incorrectas');
        });

        app.post('/config/dispositivo/eliminar', requireAuth, async (req, res) => {
            const adminList = (state.instalacion.GENERAL.administradores || '').split(',').map(u => u.trim());
            const isAdmin = adminList.includes(req.session.user);
            if (!isAdmin) return res.status(403).json({ error: 'Acceso denegado' });

            const { section } = req.body;
            if (section === undefined || section === null) return res.status(400).json({ error: 'Sección requerida' });

            if (!state.instalacion.Dispositivos[section]) {
                return res.status(404).json({ error: 'Dispositivo no encontrado' });
            }

            const deviceId = state.instalacion.Dispositivos[section].Id;
            delete state.instalacion.Dispositivos[section];

            // Rebuild identifiers
            state.identificadores = {};
            Object.keys(state.instalacion.Dispositivos).forEach(key => {
                const dev = state.instalacion.Dispositivos[key];
                 if (dev && dev.Id) state.identificadores[dev.Id] = key;
            });

            try {
                await saveConfig(state.instalacion);
                logger.info(`Dispositivo eliminado: [${section}] ${deviceId}`);
                res.json({ success: true });
            } catch (e) {
                res.status(500).json({ error: 'Error al salvar la configuración' });
            }
        });

        app.get('/franjas', (req, res) => {
            const dirPath = path.join(__dirname, 'public', 'media');
            fs.readdir(dirPath, (err, files) => {
                if (err) return res.status(500).json({ error: 'Error reading directory' });
                const images = files
                    .filter(file => file.startsWith('franja') && file.endsWith('.jpg'))
                    .map(file => `/media/${file}`);
                res.json(images);
            });
        });

        // Protect device/status routes with session auth
        // Protect device/status routes with session auth
        app.get('/dispositivos.json', requireAuth, (req, res) => {
            const dispositivos = {};
            if (state.instalacion.Dispositivos) {
                Object.keys(state.instalacion.Dispositivos).forEach(key => {
                     const device = state.instalacion.Dispositivos[key];
                     dispositivos[key] = {
                         Id: device.Id,
                         Nombre: device.Descripcion,
                         Switch: device.Interruptor || 'switch_1',
                         Icon: device.Icon || '',
                         IconOn: device.IconOn || 'lightbulb-fill',
                         IconOff: device.IconOff || 'lightbulb-off',
                         // Preserve other fields
                         ...device
                     };
                });
            }
            res.json(dispositivos);
        });

        app.get('/log/:lin', requireAuth, async (req, res) => {
            try {
                const param = req.params.lin.toString().toLowerCase();
                const isYesterday = param === 'yesterday';
                const is24h = param === '24h';
                const data = await fsp.readFile(logger.logFile || path.join(__dirname, 'logs', 'server.log'), 'utf8').catch(() => '');
                const lines = data.split('\n').filter(line => line.trim() !== '');

                let result;
                if (is24h) {
                    // Ultimas 24 horas desde ahora, lo mas nuevo primero
                    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
                    const filtered = lines.filter(line => {
                        const tsMatch = line.match(/"time":(\d+)/);
                        if (!tsMatch) return false;
                        return Number(tsMatch[1]) >= cutoff;
                    });
                    result = filtered.reverse();
                } else if (isYesterday) {
                    const yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);
                    const yyyymmdd = yesterday.toISOString().slice(0, 10);
                    const filtered = lines.filter(line => {
                        const tsMatch = line.match(/"time":(\d+)/);
                        if (!tsMatch) return line.includes(yyyymmdd);
                        const ts = new Date(Number(tsMatch[1])).toISOString().slice(0, 10);
                        return ts === yyyymmdd;
                    });
                    // Fallback: si no hay entradas de ayer, devolver las ultimas 50 lineas
                    result = filtered.length > 0 ? filtered.reverse() : lines.slice(-50).reverse();
                } else {
                    const lin = parseInt(req.params.lin) || 35;
                    result = lines.slice(-lin).reverse();
                }

                return res.json(result.map(line => {
                    try {
                        const parsed = JSON.parse(line);
                        const time = new Date(parsed.time).toISOString().replace('T', ' ').slice(0, 19);
                        const level = ({ 10: 'TRACE', 20: 'DEBUG', 30: 'INFO', 40: 'WARN', 50: 'ERROR', 60: 'FATAL' })[parsed.level] || 'LOG';
                        return `[${time}] ${level}: ${parsed.msg}`;
                    } catch {
                        return line;
                    }
                }));
            } catch (err) {
                logger.error('Error leyendo log:', err);
                return res.status(500).json({ error: 'Error leyendo log del servidor' });
            }
        });

        app.get('/estado/:id', requireAuth, async (req, res) => {
            const term = await getEstado(req.params.id);
            if (!term.success) return res.status(500).json(term);
            res.json(term);
        });

        app.get('/esp32', requireAuth, (req, res) => {
            const dspStr = req.query.esp32;
            if (!dspStr) return res.status(400).json({ error: 'Parámetro esp32 requerido' });

            const dsp = parseInt(dspStr);
            if (isNaN(dsp)) return res.status(400).json({ error: 'Parámetro esp32 debe ser un número entero' });

            const result = [];

            // Filter and gather devices
            Object.keys(state.instalacion.Dispositivos).forEach(key => {
                 const device = state.instalacion.Dispositivos[key];
                 if (device.Esp32Dsp && parseInt(device.Esp32Dsp) === dsp) {
                    // Only include if Esp32Pag is defined
                    if (device.Esp32Pag) {
                        result.push({
                            deviceId: device.Id,
                            deviceName: device.Descripcion,
                            deviceType: device.Esp32Tip,
                            enabled: true,
                            _sort: parseInt(device.Esp32Pag)
                        });
                    }
                }
            });

            // Add Weather page if enabled
            const weatherEnabled = state.instalacion.GENERAL[`WeatherEnabled_${dsp}`] !== 'false';
            if (weatherEnabled) {
                const weatherPage = parseInt(state.instalacion.GENERAL[`WeatherPage_${dsp}`] || 1);
                result.push({
                    deviceId: 'WEATHER',
                    deviceName: 'Información del Tiempo',
                    deviceType: 'Weather',
                    enabled: true,
                    _sort: weatherPage
                });
            }

            // Add Energy page if enabled
            const energyEnabled = state.instalacion.GENERAL[`EnergyEnabled_${dsp}`] !== 'false';
            if (energyEnabled) {
                const energyPage = parseInt(state.instalacion.GENERAL[`EnergyPage_${dsp}`] || 1);
                result.push({
                    deviceId: 'ENERGY',
                    deviceName: 'Monitor Energía',
                    deviceType: 'Energy',
                    enabled: true,
                    _sort: energyPage
                });
            }

            // Sort by position
            result.sort((a, b) => (a._sort - b._sort) || a.deviceName.localeCompare(b.deviceName));

            // Remove internal sort key
            const cleanResult = result.map(({ _sort, ...rest }) => rest);

            // Get theme and timestamp
            const theme = state.instalacion.GENERAL[`Theme_${dsp}`] || 'noche';
            const ts = state.instalacion.GENERAL[`Timestamp_${dsp}`] || '0';

            res.json({
                devices: cleanResult,
                theme: theme,
                timestamp: ts
            });
        });


        app.get('/estados', requireAuth, async (req, res) => {
            try {
                // Optimización: Intentamos obtener (y cachear) el UID si no lo tenemos
                if (!state.uid) {
                    const existingIds = Object.keys(state.identificadores);
                    for (const devId of existingIds) {
                        try {
                            const devInfo = await getInfo(devId);
                            if (devInfo.success && devInfo.result && devInfo.result.uid) {
                                state.uid = devInfo.result.uid;
                                logger.info(`UID de Tuya detectado y cacheado: ${state.uid}`);
                                break;
                            }
                        } catch (ignore) { }
                    }
                }

                const info = await getTodosDispositivos(state.uid);

                if (info.success && (info.result.list || Array.isArray(info.result))) {
                    const devices = info.result.list || info.result;
                    const result = {};

                    // Mapeamos los estados por ID de dispositivo
                    devices.forEach(dev => {
                        // Solo nos interesan los dispositivos que tenemos configurados
                        if (state.identificadores[dev.id]) {
                            result[dev.id] = {
                                status: dev.status,
                                online: dev.online
                            };
                        }
                    });

                    res.json({ success: true, result: result });
                } else {
                    // Si falla la obtención masiva, devolvemos error
                    res.status(500).json({ error: 'Error al obtener dispositivos', details: info });
                }

            } catch (e) {
                logger.error('Error al obtener estados:', e);
                res.status(500).json({ error: 'Error interno' });
            }
        });

        app.get('/weather/current', requireAuth, (req, res) => {
            const now = new Date();
            const dia = now.toISOString().split('T')[0];
            const hor = now.getHours().toString().padStart(2, '0');
            const jsonDir = path.join(state.dirname, 'public', 'json');
            const fic = path.join(jsonDir, `${dia}_tiempo.json`);

            if (fs.existsSync(fic)) {
                try {
                    const data = JSON.parse(fs.readFileSync(fic, 'utf8'));
                    const currentHourData = data[hor];
                    if (currentHourData) {
                        let weatherInfo = null;

                        // New structure compatibility: Check inside sensors
                        if (currentHourData.sensors) {
                            // Find the first sensor that looks like an external provider (has ubi or idema)
                            const providerKey = Object.keys(currentHourData.sensors).find(k =>
                                currentHourData.sensors[k].ubi || currentHourData.sensors[k].idema
                            );
                            if (providerKey) {
                                weatherInfo = currentHourData.sensors[providerKey];
                            }
                        } else if (currentHourData.ubi) {
                            // Old structure fallback (should not be hit if migration ran, but safety first)
                            weatherInfo = currentHourData;
                        }

                        if (weatherInfo) {
                            return res.json({
                                success: true,
                                data: {
                                    ubi: weatherInfo.ubi,
                                    ta: weatherInfo.ta,
                                    hr: weatherInfo.hr,
                                    icon: weatherInfo.icon
                                }
                            });
                        }
                    } else {
                        return res.json({ success: false, message: 'No hay datos para esta hora' });
                    }
                } catch (e) {
                    logger.error('Error leyendo fichero de tiempo:', e);
                    return res.status(500).json({ success: false, error: 'Error interno' });
                }
            } else {
                return res.json({ success: false, message: 'No hay datos para hoy' });
            }
        });

        app.get('/energy/status', requireAuth, (req, res) => {
            try {
                const currentPower = getLastPowerReading();
                const currentPrice = getCurrentTarifaValue(state.tarifa);

                // Determine price level: 0 (Cheap), 1 (Normal), 2 (Expensive)
                // We can use isCurrentHourAmongCheapest logic or simple heuristic
                // Heuristic based on average:
                // Let's use simple heuristic for now or re-use tariff manager logic if possible
                // isCurrentHourAmongCheapest(tarifa, 8) -> returns true if in cheapest 8 hours

                let priceLevel = 1; // Normal
                if (state.tarifa) {
                    if (isCurrentHourAmongCheapest(state.tarifa, 8)) {
                        priceLevel = 0; // Cheap/Valle
                    } else if (!isCurrentHourAmongCheapest(state.tarifa, 16)) {
                         priceLevel = 2; // Expensive/Punta (if not in cheapest 16)
                    }
                }

                res.json({
                    power: currentPower,
                    price: currentPrice,
                    priceLevel: priceLevel,
                    maxPower: state.instalacion.GENERAL.ConsumoMaximo || 5500
                });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        app.get('/alternar/:id/:est', requireAuth, async (req, res) => {
            const est = parseInt(req.params.est);
            const term = await alternar(req.params.id, est, state.instalacion, state.identificadores);
            if (!term.success) return res.status(500).json(term);

            const key = state.identificadores[req.params.id];
            logger.info(`Dispositivo ${key} ${state.instalacion.Dispositivos[key]?.Descripcion} alternado a ${est}`);
            res.json(term);
        });

        // User Preferences Endpoints
        const prefsDir = path.join(__dirname, 'user_prefs');
        if (!fs.existsSync(prefsDir)) {
            fs.mkdirSync(prefsDir, { recursive: true });
        }

        app.get('/user/prefs', requireAuth, (req, res) => {
            const user = req.session.user;
            const prefsPath = path.join(prefsDir, `${user}.json`);

            if (fs.existsSync(prefsPath)) {
                try {
                    const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
                    res.json(prefs);
                } catch (e) {
                    logger.error(`Error reading prefs for user ${user}:`, e);
                    res.json({}); // Default empty prefs on error
                }
            } else {
                res.json({}); // Default empty prefs
            }
        });

        app.post('/user/prefs', requireAuth, (req, res) => {
            const user = req.session.user;
            const prefsPath = path.join(prefsDir, `${user}.json`);
            const newPrefs = req.body;

            try {
                fs.writeFileSync(prefsPath, JSON.stringify(newPrefs, null, 2), 'utf8');
                res.json({ success: true });
            } catch (e) {
                logger.error(`Error saving prefs for user ${user}:`, e);
                res.status(500).json({ error: 'Error al guardar las preferencias' });
            }
        });

        app.get('/mingotouchs', requireAuth, (req, res) => {
            const result = [];
            if (state.instalacion.MingoTouchs) {
                Object.keys(state.instalacion.MingoTouchs).forEach(key => {
                    const mt = state.instalacion.MingoTouchs[key];
                    result.push({
                        id: parseInt(key),
                        name: mt.Nombre || `MingoTouch ${key}`,
                        type: mt.Tipo || 'Standard'
                    });
                });
            }
            res.json(result.sort((a, b) => a.id - b.id));
        });

        app.get('/mingotouchs/:dsp/timestamp', (req, res) => {
            const dsp = req.params.dsp;
            const ts = state.instalacion.GENERAL[`Timestamp_${dsp}`] || '0';
            res.json({ timestamp: ts });
        });

        app.get('/mingotouchs/list', requireAuth, (req, res) => {
            res.json({
                devices: state.instalacion.MingoTouchs || {},
                ngrokUrl: state.ngrokUrl || null
            });
        });

        app.get('/mingotouchs/:dsp', requireAuth, (req, res) => {
            const dsp = parseInt(req.params.dsp);
            if (isNaN(dsp)) return res.status(400).json({ error: 'ID de ESP32 inválido' });

            const assigned = [];
            const unassigned = [];

            if (state.instalacion.Dispositivos) {
                Object.keys(state.instalacion.Dispositivos).forEach(key => {
                    const device = state.instalacion.Dispositivos[key];
                    // Check if assigned to this dsp
                    const assignment = device.MingoTouchs ? device.MingoTouchs.find(m => m.MTDsp == dsp) : null;

                    const devObj = {
                        section: key,
                        id: device.Id,
                        name: device.Descripcion,
                        page: assignment ? parseInt(assignment.MTPag || 0) : 0,
                        type: assignment ? (assignment.MTTip || 'Enchufe') : 'Enchufe',
                        dsp: assignment ? dsp : 0,
                        assigned: !!assignment
                    };

                    if (assignment) {
                        assigned.push(devObj);
                    } else {
                        unassigned.push(devObj);
                    }
                });
            }

            // Add Weather page to the list of assigned or unassigned items
            const weatherEnabled = state.instalacion.GENERAL[`WeatherEnabled_${dsp}`] !== 'false';
            const weatherPage = parseInt(state.instalacion.GENERAL[`WeatherPage_${dsp}`] || 1);

            const weatherObj = {
                section: 'WEATHER',
                id: 'WEATHER',
                name: 'Información del Tiempo',
                page: weatherPage,
                type: 'Weather'
            };

            if (weatherEnabled) {
                assigned.push(weatherObj);
            } else {
                unassigned.push(weatherObj);
            }

            // Energry Card Logic
            const energyEnabled = state.instalacion.GENERAL[`EnergyEnabled_${dsp}`] !== 'false';
            const energyPage = parseInt(state.instalacion.GENERAL[`EnergyPage_${dsp}`] || 1);

            const energyObj = {
                section: 'ENERGY',
                id: 'ENERGY',
                name: 'Monitor Energía',
                page: energyPage,
                type: 'Energy'
            };

            if (energyEnabled) {
                assigned.push(energyObj);
            } else {
                unassigned.push(energyObj);
            }

            assigned.sort((a, b) => (a.page - b.page) || a.name.localeCompare(b.name));
            unassigned.sort((a, b) => a.name.localeCompare(b.name));

            const theme = state.instalacion.GENERAL[`Theme_${dsp}`] || 'noche';
            res.json({ assigned, unassigned, theme });
        });

        // =========================================================================
        // UNIFIED ESP32 UPDATE ENDPOINT
        // =========================================================================
        app.get('/esp32/update/:dsp', requireAuth, async (req, res) => {
            const dspStr = req.params.dsp;
            const dsp = parseInt(dspStr);
            if (isNaN(dsp)) return res.status(400).json({ error: 'Parámetro esp32 debe ser un número entero' });

            try {
                // 1. Devices and base config (logic from /esp32)
                const deviceList = [];
                if (state.instalacion.Dispositivos) {
                    Object.keys(state.instalacion.Dispositivos).forEach(key => {
                        const device = state.instalacion.Dispositivos[key];
                        if (device.MingoTouchs) {
                            const assignment = device.MingoTouchs.find(m => m.MTDsp == dsp);
                            if (assignment && assignment.MTPag) {
                                deviceList.push({
                                    deviceId: device.Id,
                                    deviceName: device.Descripcion,
                                    deviceType: assignment.MTTip,
                                    enabled: true,
                                    _sort: parseInt(assignment.MTPag)
                                });
                            }
                        }
                    });
                }

                const weatherEnabled = state.instalacion.GENERAL[`WeatherEnabled_${dsp}`] !== 'false';
                if (weatherEnabled) {
                    deviceList.push({ deviceId: 'WEATHER', deviceName: 'Información del Tiempo', deviceType: 'Weather', enabled: true, _sort: parseInt(state.instalacion.GENERAL[`WeatherPage_${dsp}`] || 1) });
                }
                const energyEnabled = state.instalacion.GENERAL[`EnergyEnabled_${dsp}`] !== 'false';
                if (energyEnabled) {
                    deviceList.push({ deviceId: 'ENERGY', deviceName: 'Monitor Energía', deviceType: 'Energy', enabled: true, _sort: parseInt(state.instalacion.GENERAL[`EnergyPage_${dsp}`] || 1) });
                }
                deviceList.sort((a, b) => (a._sort - b._sort) || a.deviceName.localeCompare(b.deviceName));
                const cleanDevices = deviceList.map(({ _sort, ...rest }) => rest);

                // 2. States (logic from /estados)
                if (!state.uid) {
                    const existingIds = Object.keys(state.identificadores);
                    for (const devId of existingIds) {
                        try {
                            const devInfo = await getInfo(devId);
                            if (devInfo.success && devInfo.result && devInfo.result.uid) {
                                state.uid = devInfo.result.uid;
                                break;
                            }
                        } catch (ignore) { }
                    }
                }
                const statesInfo = await getTodosDispositivos(state.uid);
                const statesResult = {};
                if (statesInfo.success && (statesInfo.result.list || Array.isArray(statesInfo.result))) {
                    const devices = statesInfo.result.list || statesInfo.result;
                    devices.forEach(dev => {
                        if (state.identificadores[dev.id]) {
                            statesResult[dev.id] = dev.status;
                        }
                    });
                }

                // 3. Weather (logic from /weather/current)
                let weatherData = null;
                const now = new Date();
                const dia = now.toISOString().split('T')[0];
                const hor = now.getHours().toString().padStart(2, '0');
                const jsonDir = path.join(state.dirname, 'public', 'json');
                const weatherFic = path.join(jsonDir, `${dia}_tiempo.json`);
                if (fs.existsSync(weatherFic)) {
                    try {
                        const data = JSON.parse(fs.readFileSync(weatherFic, 'utf8'));
                        const currentHourData = data[hor];
                        if (currentHourData && currentHourData.sensors) {
                            const providerKey = Object.keys(currentHourData.sensors).find(k => currentHourData.sensors[k].ubi || currentHourData.sensors[k].idema);
                            if (providerKey) {
                                const w = currentHourData.sensors[providerKey];
                                weatherData = { ubi: w.ubi, ta: w.ta, hr: w.hr, icon: w.icon };
                            }
                        }
                    } catch (e) { logger.error('Error weather update:', e); }
                }

                // 4. Energy (logic from /energy/status)
                let energyData = null;
                let hourlyConsumption = Array(24).fill(0);
                let hourlyPrices = Array(24).fill(0);
                try {
                    const currentPower = getLastPowerReading();
                    const currentPrice = getCurrentTarifaValue(state.tarifa);
                    let priceLevel = 1;
                    if (state.tarifa) {
                        if (isCurrentHourAmongCheapest(state.tarifa, 8)) priceLevel = 0;
                        else if (!isCurrentHourAmongCheapest(state.tarifa, 16)) priceLevel = 2;
                    }
                    energyData = { power: currentPower, price: currentPrice, priceLevel: priceLevel, maxPower: state.instalacion.GENERAL.ConsumoMaximo || 5500 };

                    // Hourly Consumption & Prices Calculation
                    const medidorId = state.instalacion.GENERAL.MedidorGeneral || "0";
                    const consumoFic = path.join(jsonDir, `${dia}_consumo.json`);

                    // Map current tarifa to 24 hourly prices
                    if (state.tarifa) {
                        state.tarifa.forEach(t => {
                            const tDate = new Date(t.datetime);
                            if (tDate.toISOString().slice(0, 10) === dia) {
                                const h = tDate.getHours();
                                if (h >= 0 && h < 24) hourlyPrices[h] = t.value;
                            }
                        });
                    }

                    if (fs.existsSync(consumoFic)) {
                        const data = JSON.parse(fs.readFileSync(consumoFic, 'utf8'));
                        for (let h = 0; h < 24; h++) {
                            const hStr = h.toString().padStart(2, '0');
                            if (data[hStr]) {
                                let sumPower = 0;
                                let count = 0;
                                Object.values(data[hStr]).forEach(minVal => {
                                    let val = 0;
                                    if (typeof minVal === 'number') val = minVal;
                                    else if (minVal && minVal[medidorId] !== undefined) val = minVal[medidorId];
                                    else if (minVal && minVal["0"] !== undefined) val = minVal["0"];

                                    sumPower += val;
                                    count++;
                                });
                                // Wh for this hour = (sum of power readings in tenths / 10) / 60
                                // If we have fewer than 60 readings, we still divide by 60 because each reading is a minute
                                if (count > 0) {
                                    hourlyConsumption[h] = Math.round((sumPower / 10) / 60);
                                }
                            }
                        }
                    }
                } catch (e) { logger.error('Error energy update:', e); }

                // Final response
                res.json({
                    success: true,
                    timestamp: state.instalacion.GENERAL[`Timestamp_${dsp}`] || '0',
                    theme: state.instalacion.GENERAL[`Theme_${dsp}`] || 'noche',
                    time: {
                        now: now.toISOString(),
                        formatted: now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                    },
                    devices: cleanDevices,
                    states: statesResult,
                    weather: weatherData,
                    energy: energyData,
                    hourlyConsumption: hourlyConsumption,
                    hourlyPrices: hourlyPrices
                });

            } catch (e) {
                logger.error('Unified Update Error:', e);
                res.status(500).json({ success: false, error: 'Internal Server Error' });
            }
        });

        app.post('/mingotouchs/theme', requireAuth, async (req, res) => {
            const adminList = (state.instalacion.GENERAL.administradores || '').split(',').map(u => u.trim());
            if (!adminList.includes(req.session.user)) return res.status(403).json({ error: 'Acceso denegado' });

            const { dsp, theme } = req.body;
            if (!dsp || !theme) return res.status(400).json({ error: 'Parámetros insuficientes' });

            state.instalacion.GENERAL[`Theme_${dsp}`] = theme;

            try {
                await saveConfig(state.instalacion);
                await updateMingoTimestamp(dsp);
                res.json({ success: true });
            } catch (e) {
                res.status(500).json({ error: 'Error al salvar la configuración' });
            }
        });

        app.post('/mingotouchs/add', requireAuth, async (req, res) => {
            const adminList = (state.instalacion.GENERAL.administradores || '').split(',').map(u => u.trim());
            if (!adminList.includes(req.session.user)) return res.status(403).json({ error: 'Acceso denegado' });

            const { dsp, section } = req.body;
            if (!dsp || section === undefined) return res.status(400).json({ error: 'Parámetros insuficientes' });

            if (section === 'WEATHER') {
                state.instalacion.GENERAL[`WeatherEnabled_${dsp}`] = 'true';
                try {
                    await saveConfig(state.instalacion);
                    await updateMingoTimestamp(dsp);
                    res.json({ success: true });
                } catch (e) {
                    res.status(500).json({ error: 'Error al salvar la configuración' });
                }
            } else if (state.instalacion.Dispositivos[section]) {
                const device = state.instalacion.Dispositivos[section];
                if (!device.MingoTouchs) device.MingoTouchs = [];

                // Check if already assigned
                const existing = device.MingoTouchs.find(m => m.MTDsp == dsp);
                if (existing) return res.status(400).json({ error: 'Dispositivo ya asignado a este MingoTouch' });

                // Find highest page for this dsp across all devices
                let maxPage = 1;
                Object.values(state.instalacion.Dispositivos).forEach(d => {
                    if (d.MingoTouchs) {
                        d.MingoTouchs.forEach(m => {
                            if (m.MTDsp == dsp && parseInt(m.MTPag) >= maxPage) {
                                maxPage = parseInt(m.MTPag) + 1;
                            }
                        });
                    }
                });

                // Also check weather page
                const weatherPage = parseInt(state.instalacion.GENERAL[`WeatherPage_${dsp}`] || 1);
                if (weatherPage >= maxPage) maxPage = weatherPage + 1;
                const energyPage = parseInt(state.instalacion.GENERAL[`EnergyPage_${dsp}`] || 1);
                if (energyPage >= maxPage) maxPage = energyPage + 1;

                device.MingoTouchs.push({
                    MTDsp: dsp,
                    MTPag: maxPage.toString(),
                    MTTip: 'Enchufe'
                });

                try {
                    await saveConfig(state.instalacion);
                    await updateMingoTimestamp(dsp);
                    res.json({ success: true });
                } catch (e) {
                    res.status(500).json({ error: 'Error al salvar la configuración' });
                }
            } else {
                res.status(404).json({ error: 'Dispositivo no encontrado' });
            }
        });

        app.post('/mingotouchs/remove', requireAuth, async (req, res) => {
            const adminList = (state.instalacion.GENERAL.administradores || '').split(',').map(u => u.trim());
            if (!adminList.includes(req.session.user)) return res.status(403).json({ error: 'Acceso denegado' });

            const { dsp, section } = req.body;
            if (section === undefined) return res.status(400).json({ error: 'Parámetros insuficientes' });

            if (section === 'WEATHER') {
                if (!dsp) return res.status(400).json({ error: 'DSP requerido para el tiempo' });
                state.instalacion.GENERAL[`WeatherEnabled_${dsp}`] = 'false';
                try {
                    await saveConfig(state.instalacion);
                    await updateMingoTimestamp(dsp);
                    res.json({ success: true });
                } catch (e) {
                    res.status(500).json({ error: 'Error al salvar la configuración' });
                }
            } else if (section === 'ENERGY') {
                if (!dsp) return res.status(400).json({ error: 'DSP requerido para energía' });
                state.instalacion.GENERAL[`EnergyEnabled_${dsp}`] = 'false';
                try {
                    await saveConfig(state.instalacion);
                    await updateMingoTimestamp(dsp);
                    res.json({ success: true });
                } catch (e) {
                    res.status(500).json({ error: 'Error al salvar la configuración' });
                }
            } else if (state.instalacion.Dispositivos[section]) {
                const device = state.instalacion.Dispositivos[section];
                if (device.MingoTouchs) {
                    device.MingoTouchs = device.MingoTouchs.filter(m => m.MTDsp != dsp);
                }

                try {
                    await saveConfig(state.instalacion);
                    await updateMingoTimestamp(dsp);
                    res.json({ success: true });
                } catch (e) {
                    res.status(500).json({ error: 'Error al salvar la configuración' });
                }
            } else {
                res.status(404).json({ error: 'Dispositivo no encontrado' });
            }
        });

        app.post('/mingotouchs/reorder', requireAuth, async (req, res) => {
            const adminList = (state.instalacion.GENERAL.administradores || '').split(',').map(u => u.trim());
            const isAdmin = adminList.includes(req.session.user);
            if (!isAdmin) return res.status(403).json({ error: 'Acceso denegado' });

            const { dsp, order } = req.body; // order: array de { section, page, type }
            if (!dsp || !Array.isArray(order)) return res.status(400).json({ error: 'Parámetros insuficientes' });

            order.forEach(item => {
                if (item.section === 'WEATHER') {
                    state.instalacion.GENERAL[`WeatherPage_${dsp}`] = item.page.toString();
                } else if (item.section === 'ENERGY') {
                    state.instalacion.GENERAL[`EnergyPage_${dsp}`] = item.page.toString();
                } else if (state.instalacion.Dispositivos[item.section]) {
                    const device = state.instalacion.Dispositivos[item.section];
                    if (device.MingoTouchs) {
                        const assignment = device.MingoTouchs.find(m => m.MTDsp == dsp);
                        if (assignment) {
                            assignment.MTPag = item.page.toString();
                            if (item.type) assignment.MTTip = item.type;
                        }
                    }
                }
            });

            try {
                await saveConfig(state.instalacion);
                await updateMingoTimestamp(dsp);
                logger.info(`Reordenadas páginas para ESP32 Dsp=${dsp}`);
                res.json({ success: true });
            } catch (e) {
                res.status(500).json({ error: 'Error al salvar la configuración' });
            }
        });

        // Alert Endpoints
        app.get('/alerts', requireAuth, (req, res) => {
            const user = req.session.user;
            const adminList = (state.instalacion.GENERAL.administradores || '').split(',').map(u => u.trim());

            if (!adminList.includes(user)) {
                return res.json([]); // Regular users don't see alerts
            }

            const userAlerts = state.alertManager.getAlertsForUser(user);
            res.json(userAlerts);
        });

        app.post('/alerts/acknowledge', requireAuth, async (req, res) => {
            const { id } = req.body;
            const user = req.session.user;
            if (!id) return res.status(400).json({ error: 'Falta ID de alerta' });

            const adminList = (state.instalacion.GENERAL.administradores || '').split(',').map(u => u.trim());
            const success = await state.alertManager.acknowledge(id, user, adminList);
            res.json({ success });
        });

        app.post('/alerts/acknowledge-multiple', requireAuth, async (req, res) => {
            const { ids } = req.body;
            const user = req.session.user;
            if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'Faltan IDs de alertas' });

            const adminList = (state.instalacion.GENERAL.administradores || '').split(',').map(u => u.trim());
            let successCount = 0;
            for (const id of ids) {
                const success = await state.alertManager.acknowledge(id, user, adminList);
                if (success) successCount++;
            }
            res.json({ success: true, count: successCount });
        });

        // Endpoint para obtener consumo diario de un mes específico
        app.get('/consumo/diario/:anio/:mes', async (req, res) => {
            const { anio, mes } = req.params;
            const diasEnMes = new Date(anio, mes, 0).getDate();
            const resultados = [];

            try {
                for (let i = 1; i <= diasEnMes; i++) {
                    const diaStr = String(i).padStart(2, '0');
                    const fecha = `${anio}-${mes}-${diaStr}`;
                    const consumoFile = path.join(__dirname, 'public', 'json', `${fecha}_consumo.json`);
                    const redeFile = path.join(__dirname, 'public', 'json', `${fecha}_rede.json`);

                    let consumoDia = 0;
                    let costeDia = 0;
                    let hasData = false;

                    try {
                        // Leer consumo
                        const consumoData = JSON.parse(await fs.promises.readFile(consumoFile, 'utf8'));
                        hasData = true;

                        // Leer precios (opcional)
                        let preciosData = [];
                        try {
                            preciosData = JSON.parse(await fs.promises.readFile(redeFile, 'utf8'));
                        } catch (e) {}

                        // Calcular consumo y coste hora a hora
                        for (let h = 0; h < 24; h++) {
                            const hStr = String(h).padStart(2, '0');
                            if (!consumoData[hStr]) continue;

                            let consumoHora = 0; // en Wh

                            // Sumar consumo
                            const medidorId = state.instalacion.GENERAL.MedidorGeneral || "0";
                            Object.values(consumoData[hStr]).forEach(minVal => {
                                 let val = 0;
                                 if (typeof minVal === 'number') val = minVal;
                                 else if (minVal) {
                                     if (minVal[medidorId] !== undefined) val = minVal[medidorId];
                                     else if (minVal["0"] !== undefined) val = minVal["0"]; // Fallback to "0"
                                     else {
                                         // If specific meter not found, try first key? No, safer to be 0 or log.
                                         // logger.info('DEBUG: No reading for meter', medidorId, 'in', minVal);
                                     }
                                 }

                                 // val es potencia en décimas de W. Wh = (val/10) * (1/60h)
                                 consumoHora += (val / 10) / 60.0;
                            });

                            consumoDia += consumoHora; // Wh

                            // Coste
                            if (preciosData.length > h && preciosData[h]) {
                                // value es €/MWh
                                const precioMWh = preciosData[h].value || 0;
                                costeDia += (consumoHora / 1000000) * precioMWh;
                            }
                        }

                    } catch (err) {
                        // Fichero no existe, ignorar
                    }

                    if (hasData) {
                        resultados.push({
                            fecha: fecha,
                            consumo: consumoDia, // Wh
                            coste: costeDia // €
                        });
                    }
                }

                res.json({ success: true, result: resultados });

            } catch (error) {
                logger.error(error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Logout: destroy session and redirect to root (client will show login modal)
        app.get('/logout', (req, res) => {
            if (req.session) {
                req.session.destroy(err => {
                    // ignore errors
                    return res.redirect('/');
                });
            } else {
                return res.redirect('/');
            }
        });

        app.listen(serverPort, serverHost, () => {
            logger.info(`Servidor montado en ${serverHost}:${serverPort}`);
        });

        if (webHook === 'ngrok' && ngrokToken) {
            ngrok.connect({ addr: `${serverHost}:${serverPort}`, authtoken: ngrokToken, domain: ngrokDomain })
                .then(listener => {
                    const url = listener.url();
                    logger.info(`Ingress established at: ${url}`);
                    state.ngrokUrl = url;
                })
                .catch(err => {
                    logger.error('Could not start ngrok listener:', err.message);
                });
        }

    } catch (error) {
        logger.error('Initialization failed:', error);
        process.exit(1);
    }
}

startServer();
