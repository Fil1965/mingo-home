/**
 * Tests para el helper de configuración de sesión.
 *
 * Cubre:
 *  - Defaults sensatos en desarrollo
 *  - Secret por defecto rechazado en producción (lanza error)
 *  - Secret por defecto en desarrollo: se acepta PERO el helper debe avisar
 *    mediante el callback `onWarn` (no se imprime directo a consola para no
 *    contaminar la salida de CI).
 *  - Cookie httpOnly/sameSite siempre activos
 *  - secure:true en producción, false en dev (testeable)
 *  - maxAge configurable
 */

import assert from 'assert';

const { buildSessionOptions } = await import('../src/api/middleware/session.mjs');

// Helper: captura warnings emitidos por el helper
function captureWarnings(fn) {
    const warnings = [];
    fn({ onWarn: (msg) => warnings.push(msg) });
    return warnings;
}

// 1) Devuelve objeto con secret, cookie y resave/saveUninitialized
{
    const opts = buildSessionOptions({ secret: 'abc', isProduction: false });
    assert.strictEqual(opts.secret, 'abc');
    assert.strictEqual(opts.resave, false);
    assert.strictEqual(opts.saveUninitialized, false);
    assert.ok(opts.cookie, 'debe tener cookie config');
}

// 2) Cookie: httpOnly true
{
    const opts = buildSessionOptions({ secret: 'x', isProduction: false });
    assert.strictEqual(opts.cookie.httpOnly, true, 'httpOnly debe ser true');
}

// 3) Cookie: sameSite lax
{
    const opts = buildSessionOptions({ secret: 'x', isProduction: false });
    assert.strictEqual(opts.cookie.sameSite, 'lax');
}

// 4) secure false en dev
{
    const opts = buildSessionOptions({ secret: 'x', isProduction: false });
    assert.strictEqual(opts.cookie.secure, false);
}

// 5) secure true en producción
{
    const opts = buildSessionOptions({ secret: 'x', isProduction: true });
    assert.strictEqual(opts.cookie.secure, true);
}

// 6) maxAge por defecto: 24h
{
    const opts = buildSessionOptions({ secret: 'x', isProduction: false });
    assert.strictEqual(opts.cookie.maxAge, 24 * 60 * 60 * 1000);
}

// 7) maxAge configurable
{
    const opts = buildSessionOptions({ secret: 'x', isProduction: false, maxAgeMs: 60_000 });
    assert.strictEqual(opts.cookie.maxAge, 60_000);
}

// 8) path por defecto '/'
{
    const opts = buildSessionOptions({ secret: 'x', isProduction: false });
    assert.strictEqual(opts.cookie.path, '/');
}

// 9) Secret por defecto en producción: lanza error
{
    let threw = false;
    try {
        buildSessionOptions({ secret: 'cambiar-esta-clave', isProduction: true });
    } catch (err) {
        threw = true;
        assert.ok(err.message.includes('SESSION_SECRET') || err.message.includes('cambiar-esta-clave'),
            `Error debe mencionar el secret problemático: ${err.message}`);
    }
    assert.ok(threw, 'Debió lanzar error con secret por defecto en producción');
}

// 10) Secret vacío o undefined también rechazado en producción
{
    let threw = false;
    try {
        buildSessionOptions({ secret: '', isProduction: true });
    } catch {
        threw = true;
    }
    assert.ok(threw, 'Secret vacío en producción debe lanzar');
}

// 11) En dev, secret por defecto se acepta (con warning vía onWarn)
{
    const warnings = captureWarnings((opts) =>
        buildSessionOptions({ secret: 'cambiar-esta-clave', isProduction: false, onWarn: opts.onWarn })
    );
    assert.strictEqual(warnings.length, 1, 'debe emitir exactamente un warning');
    assert.ok(warnings[0].includes('secret por defecto') || warnings[0].includes('SESSION_SECRET'),
        `warning debe mencionar el problema: ${warnings[0]}`);
}

// 12) Cookie path personalizable
{
    const opts = buildSessionOptions({ secret: 'x', isProduction: false, cookiePath: '/api' });
    assert.strictEqual(opts.cookie.path, '/api');
}

// 13) Secret propio NO emite warning (ni en dev ni en prod)
{
    const customSecret = 'una-clave-segura-de-mas-de-treinta-y-dos-chars';
    for (const isProduction of [false, true]) {
        const warnings = captureWarnings((opts) =>
            buildSessionOptions({ secret: customSecret, isProduction, onWarn: opts.onWarn })
        );
        assert.strictEqual(warnings.length, 0,
            `Secret propio no debe avisar (isProduction=${isProduction})`);
    }
}

// 14) Sin onWarn: secret por defecto en dev NO debe lanzar, debe seguir retornando opts
//     (el helper cae a console.warn como fallback para no romper callers que no
//     inyecten logger; en CI con stdout limpio esto sigue funcionando).
{
    const opts = buildSessionOptions({ secret: 'cambiar-esta-clave', isProduction: false });
    assert.ok(opts, 'debe retornar opciones aunque no haya onWarn');
    assert.strictEqual(opts.cookie.httpOnly, true);
}

console.log('Todos los tests de session pasaron ✅');
process.exit(0);