/**
 * Middleware de autenticación / autorización.
 *
 * Exporta:
 *  - getAdminList(instalacion): util para extraer la lista de admins normalizada.
 *  - createRequireAdmin(getInstalacion): factoría que devuelve un middleware Express
 *    que aborta con 401/403 si el usuario no es admin.
 *
 * El middleware evalúa la lista de admins en CADA request, leyendo desde
 * getInstalacion() (que devuelve el objeto instalacion vivo). Esto permite
 * que cambios en la lista de admins tengan efecto inmediato sin reiniciar.
 *
 * Uso típico en server.mjs:
 *   const requireAdmin = createRequireAdmin(() => state.instalacion);
 *   app.post('/config/valor', requireAuth, requireAdmin, async (req, res) => { ... });
 */

/**
 * Normaliza la cadena `administradores` (lista separada por comas) en un array.
 * - Trim por elemento
 * - Filtra vacíos
 * - Tolera `instalacion` undefined
 * @param {Object|undefined} instalacion
 * @returns {string[]}
 */
export function getAdminList(instalacion) {
    const raw = instalacion?.GENERAL?.administradores;
    if (!raw) return [];
    return raw.split(',').map(u => u.trim()).filter(u => u !== '');
}

/**
 * Crea un middleware Express que requiere rol de administrador.
 *
 * Comportamiento:
 *  - Si el request no tiene sesión autenticada: 401 con JSON { error: 'Autenticación requerida' }.
 *  - Si el usuario autenticado está en la lista de admins: next() y req.isAdmin = true.
 *  - En caso contrario: 403 con JSON { error: 'Acceso denegado' }.
 *
 * @param {() => Object} getInstalacion - Función que devuelve el objeto instalacion vivo.
 * @returns {Function} middleware Express (req, res, next)
 */
export function createRequireAdmin(getInstalacion) {
    return function requireAdmin(req, res, next) {
        if (!req.session || !req.session.authenticated) {
            return res.status(401).json({ error: 'Autenticación requerida' });
        }

        const adminList = getAdminList(getInstalacion());
        const isAdmin = adminList.includes(req.session.user);

        if (!isAdmin) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        req.isAdmin = true;
        next();
    };
}
