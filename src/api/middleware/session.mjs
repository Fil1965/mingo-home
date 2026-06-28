/**
 * Helper de configuración de express-session.
 *
 * Centraliza la política de cookies hardened y la validación del secret.
 *
 * Defaults aplicados:
 *  - httpOnly: true                (XSS no puede robar la cookie)
 *  - sameSite: 'lax'               (protección CSRF básica)
 *  - secure: true en producción    (solo viaja por HTTPS)
 *  - path: '/'                     (toda la app)
 *  - maxAge: 24h
 *
 * Política de secret:
 *  - En producción, el secret por defecto 'cambiar-esta-clave' se rechaza
 *    lanzando un error. Es OBLIGATORIO configurar uno propio.
 *  - En desarrollo, se acepta el default pero se avisa vía `onWarn` (o
 *    `console.warn` como fallback) para que el operador sepa que debe
 *    configurar uno antes de pasar a producción.
 *
 * Uso:
 *   const opts = buildSessionOptions({
 *     secret: 'mi-clave',
 *     isProduction: NODE_ENV === 'production',
 *     onWarn: (msg) => logger.warn(msg)
 *   });
 *   app.use(session(opts));
 */

const DEFAULT_SECRET = 'cambiar-esta-clave';
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * @param {Object} options
 * @param {string} options.secret - Secreto para firmar la cookie. Obligatorio en producción.
 * @param {boolean} options.isProduction - Si true, aplica secure=true y exige secret no-por-defecto.
 * @param {number} [options.maxAgeMs] - Vida máxima de la cookie en ms.
 * @param {string} [options.cookiePath] - Path de la cookie.
 * @param {(msg: string) => void} [options.onWarn] - Callback para warnings. Si se omite, se usa console.warn.
 * @returns {Object} opciones para express-session
 */
export function buildSessionOptions(options) {
    const {
        secret,
        isProduction = false,
        maxAgeMs = DEFAULT_MAX_AGE_MS,
        cookiePath = '/',
        onWarn = (msg) => console.warn(msg)
    } = options;

    const usingDefaultSecret = secret === DEFAULT_SECRET || !secret;

    if (usingDefaultSecret) {
        if (isProduction) {
            throw new Error(
                'SESSION_SECRET inseguro. En producción (NODE_ENV=production) es OBLIGATORIO ' +
                'configurar SERVER.SessionSecret o la variable de entorno SESSION_SECRET ' +
                'con un valor aleatorio de al menos 32 caracteres.'
            );
        }
        onWarn('[session] Usando secret por defecto. Configura SERVER.SessionSecret o SESSION_SECRET antes de pasar a producción.');
    }

    return {
        secret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: isProduction,
            maxAge: maxAgeMs,
            path: cookiePath
        }
    };
}