/**
 * Middleware de CORS restrictivo.
 *
 * Política por defecto (sin origins configurados): NO se emite
 * Access-Control-Allow-Origin. El navegador bloqueará cualquier petición
 * cross-origin, lo cual es el comportamiento más seguro.
 *
 * Si se configura una allowlist en instalacion.json (`SERVER.CorsOrigins`),
 * se emite el header SOLO para los orígenes de esa lista. Si la lista es
 * `["*"]`, se emite el origin concreto de cada request (no se permite
 * `Access-Control-Allow-Origin: *` porque la app usa cookies de sesión).
 *
 * Este middleware NO usa `cors` package para evitar dependencias extra.
 *
 * Uso:
 *   const corsMw = createCorsMiddleware(config.corsOrigins);
 *   app.use(corsMw);
 */

/**
 * Determina si un origin está permitido.
 * @param {string|undefined} origin
 * @param {string[]} allowed - Lista de orígenes. '*' permite cualquiera.
 */
export function _isOriginAllowed(origin, allowed) {
    if (!origin || !allowed || allowed.length === 0) return false;
    if (allowed.includes('*')) return true;
    return allowed.includes(origin);
}

/**
 * Crea un middleware CORS con la allowlist dada.
 *
 * @param {string[]|null} allowed - Array de orígenes permitidos. null/[] = ninguno.
 * @returns {Function} middleware Express
 */
export function createCorsMiddleware(allowed) {
    const allowList = Array.isArray(allowed) ? allowed : null;

    return function corsMiddleware(req, res, next) {
        const origin = req.headers.origin;

        // OPTIONS preflight: responder sin pasar a next
        if (req.method === 'OPTIONS') {
            if (_isOriginAllowed(origin, allowList)) {
                res.header('Access-Control-Allow-Origin', origin);
            }
            res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-api-key, Authorization');
            res.header('Vary', 'Origin');
            return res.sendStatus(200);
        }

        // Same-origin o sin origin: pasar a next sin header
        if (!origin) return next();

        // Cross-origin: si el origin está permitido, emitir header
        if (_isOriginAllowed(origin, allowList)) {
            res.header('Access-Control-Allow-Origin', origin);
            res.header('Vary', 'Origin');
        }
        // Si no está permitido: no se emite header, el navegador bloqueará.
        // No es necesario abortar: el navegador lo hará por nosotros.
        next();
    };
}