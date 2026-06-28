/**
 * Tests para el middleware requireAdmin (factoría createRequireAdmin).
 *
 * Cubre:
 *  - Usuario admin pasa a next() con req.isAdmin = true
 *  - Usuario autenticado no-admin recibe 403
 *  - Usuario sin sesión recibe 401 (delegado)
 *  - Sesión no autenticada recibe 401
 *  - La lista de admins se evalúa en cada request (no se cachea)
 *  - Lista vacía o undefined deniega a todos
 *  - getAdminList normaliza correctamente
 */

import assert from 'assert';

const { createRequireAdmin, getAdminList } = await import('../src/api/middleware/auth.mjs');

function mockRes() {
    const res = {
        statusCode: 200,
        body: undefined,
        headers: {},
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
    return res;
}

/**
 * Ejecuta un middleware y devuelve:
 *  - nextCalled: si se llamó a next()
 *  - status: statusCode de la respuesta
 *  - body: cuerpo enviado
 * Nunca se cuelga: si el middleware no responde ni llama a next en 50ms,
 * se resuelve igualmente.
 */
async function runMiddleware(mw, req) {
    const res = mockRes();
    let nextCalled = false;
    let settled = false;
    return await new Promise(resolve => {
        const finalize = () => {
            if (settled) return;
            settled = true;
            resolve({ nextCalled, res, status: res.statusCode, body: res.body });
        };
        const origJson = res.json.bind(res);
        res.json = (body) => { res.body = body; origJson(body); finalize(); return res; };
        mw(req, res, () => { nextCalled = true; finalize(); });
        setTimeout(finalize, 50);
    });
}

const fakeReq = (session) => ({ session });

// 1) Admin pasa
{
    const mw = createRequireAdmin(() => ({ GENERAL: { administradores: 'alice,bob' } }));
    const r = await runMiddleware(mw, fakeReq({ authenticated: true, user: 'alice' }));
    assert.strictEqual(r.nextCalled, true, 'admin debe pasar a next()');
}

// 2) req.isAdmin se setea en true para admin
{
    const mw = createRequireAdmin(() => ({ GENERAL: { administradores: 'alice' } }));
    const req = fakeReq({ authenticated: true, user: 'alice' });
    await runMiddleware(mw, req);
    assert.strictEqual(req.isAdmin, true);
}

// 3) No-admin autenticado recibe 403
{
    const mw = createRequireAdmin(() => ({ GENERAL: { administradores: 'alice,bob' } }));
    const r = await runMiddleware(mw, fakeReq({ authenticated: true, user: 'eve' }));
    assert.strictEqual(r.nextCalled, false, 'no-admin NO debe pasar');
    assert.strictEqual(r.status, 403);
    assert.deepStrictEqual(r.body, { error: 'Acceso denegado' });
}

// 4) Sin sesión recibe 401
{
    const mw = createRequireAdmin(() => ({ GENERAL: { administradores: 'alice,bob' } }));
    const r = await runMiddleware(mw, fakeReq(undefined));
    assert.strictEqual(r.nextCalled, false);
    assert.strictEqual(r.status, 401);
    assert.deepStrictEqual(r.body, { error: 'Autenticación requerida' });
}

// 5) Sesión pero no autenticada recibe 401
{
    const mw = createRequireAdmin(() => ({ GENERAL: { administradores: 'alice' } }));
    const r = await runMiddleware(mw, fakeReq({ authenticated: false, user: 'alice' }));
    assert.strictEqual(r.nextCalled, false);
    assert.strictEqual(r.status, 401);
}

// 6) Lista se evalúa en cada request (no se cachea)
{
    let adminList = 'alice';
    const mw = createRequireAdmin(() => ({ GENERAL: { administradores: adminList } }));
    const r1 = await runMiddleware(mw, fakeReq({ authenticated: true, user: 'alice' }));
    assert.strictEqual(r1.nextCalled, true, 'alice admin en primer request');
    adminList = 'bob';
    const r2 = await runMiddleware(mw, fakeReq({ authenticated: true, user: 'alice' }));
    assert.strictEqual(r2.nextCalled, false, 'alice debe ser rechazada tras cambio');
}

// 7) Lista vacía deniega a todos
{
    const mw = createRequireAdmin(() => ({ GENERAL: { administradores: '' } }));
    const r = await runMiddleware(mw, fakeReq({ authenticated: true, user: 'alice' }));
    assert.strictEqual(r.nextCalled, false);
    assert.strictEqual(r.status, 403);
}

// 8) administradores undefined trata como lista vacía
{
    const mw = createRequireAdmin(() => ({ GENERAL: {} }));
    const r = await runMiddleware(mw, fakeReq({ authenticated: true, user: 'alice' }));
    assert.strictEqual(r.nextCalled, false);
    assert.strictEqual(r.status, 403);
}

// 9) getAdminList: trim y filtro de vacíos
{
    const list = getAdminList({ GENERAL: { administradores: ' alice , , bob , ' } });
    assert.deepStrictEqual(list, ['alice', 'bob']);
}

// 10) getAdminList: input undefined
{
    const list = getAdminList(undefined);
    assert.deepStrictEqual(list, []);
}

// 11) Documenta política: ' alice ' (con espacios) no coincide con 'alice'
{
    const mw = createRequireAdmin(() => ({ GENERAL: { administradores: 'alice' } }));
    const r = await runMiddleware(mw, fakeReq({ authenticated: true, user: ' alice ' }));
    assert.strictEqual(r.nextCalled, false, 'usuario con espacios no debe coincidir');
}

console.log('Todos los tests de requireAdmin pasaron ✅');
process.exit(0);