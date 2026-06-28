/**
 * Tests para el middleware de CORS.
 *
 * Cubre:
 *  - Sin origins configurados: NO se emite Access-Control-Allow-Origin
 *  - Origin permitido: se emite el header con el origen
 *  - Origin NO permitido: NO se emite header (cors fallará en el browser)
 *  - OPTIONS: responde 200 sin pasar a next()
 *  - WithCredentials siempre false (no se usan cookies cross-origin)
 */

import assert from 'assert';

const { createCorsMiddleware, _isOriginAllowed } = await import('../src/api/middleware/cors.mjs');

function mockReq({ origin, method = 'GET' } = {}) {
    return { headers: origin ? { origin } : {}, method };
}

function mockRes() {
    const res = {
        statusCode: 200,
        body: undefined,
        headers: {},
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        sendStatus(code) { this.statusCode = code; return this; },
        header(name, value) { this.headers[name] = value; return this; },
        set(name, value) { this.headers[name] = value; return this; }
    };
    return res;
}

async function runMw(mw, req) {
    const res = mockRes();
    let nextCalled = false;
    let settled = false;
    return await new Promise(resolve => {
        const finalize = () => {
            if (settled) return;
            settled = true;
            resolve({ nextCalled, res });
        };
        mw(req, res, () => { nextCalled = true; finalize(); });
        setTimeout(finalize, 50);
    });
}

// _isOriginAllowed
{
    assert.strictEqual(_isOriginAllowed('https://a.com', ['https://a.com']), true);
    assert.strictEqual(_isOriginAllowed('https://b.com', ['https://a.com']), false);
    assert.strictEqual(_isOriginAllowed(undefined, ['https://a.com']), false);
    assert.strictEqual(_isOriginAllowed('https://a.com', []), false);
    assert.strictEqual(_isOriginAllowed('https://A.com', ['https://a.com']), false, 'case-sensitive');
    // Wildcard
    assert.strictEqual(_isOriginAllowed('https://a.com', ['*']), true);
}

// 1) Sin origins: no se emite Allow-Origin
{
    const mw = createCorsMiddleware(null);
    const r = await runMw(mw, mockReq({ origin: 'https://evil.com' }));
    assert.strictEqual(r.nextCalled, true, 'debe pasar a next');
    assert.strictEqual(r.res.headers['Access-Control-Allow-Origin'], undefined,
        'Sin origins, no debe haber header Allow-Origin');
}

// 2) Origin permitido: se emite el header
{
    const mw = createCorsMiddleware(['https://allowed.com']);
    const r = await runMw(mw, mockReq({ origin: 'https://allowed.com' }));
    assert.strictEqual(r.res.headers['Access-Control-Allow-Origin'], 'https://allowed.com');
}

// 3) Origin NO permitido: NO se emite
{
    const mw = createCorsMiddleware(['https://allowed.com']);
    const r = await runMw(mw, mockReq({ origin: 'https://evil.com' }));
    assert.strictEqual(r.res.headers['Access-Control-Allow-Origin'], undefined);
}

// 4) OPTIONS: responde 200 sin next
{
    const mw = createCorsMiddleware(['https://a.com']);
    const r = await runMw(mw, mockReq({ origin: 'https://a.com', method: 'OPTIONS' }));
    assert.strictEqual(r.nextCalled, false, 'OPTIONS no debe pasar a next');
    assert.strictEqual(r.res.statusCode, 200);
    assert.strictEqual(r.res.headers['Access-Control-Allow-Origin'], 'https://a.com');
}

// 5) Sin origin en headers (same-origin request): pasa a next sin header
{
    const mw = createCorsMiddleware(['https://a.com']);
    const r = await runMw(mw, mockReq({ origin: undefined }));
    assert.strictEqual(r.nextCalled, true);
    assert.strictEqual(r.res.headers['Access-Control-Allow-Origin'], undefined);
}

// 6) Headers emitidos
{
    const mw = createCorsMiddleware(['https://a.com']);
    const r = await runMw(mw, mockReq({ origin: 'https://a.com' }));
    assert.strictEqual(r.res.headers['Access-Control-Allow-Origin'], 'https://a.com');
    assert.strictEqual(r.res.headers['Vary'], 'Origin',
        'debe incluir Vary: Origin para caches');
}

// 6b) OPTIONS: emite headers de preflight
{
    const mw = createCorsMiddleware(['https://a.com']);
    const r = await runMw(mw, mockReq({ origin: 'https://a.com', method: 'OPTIONS' }));
    assert.ok(r.res.headers['Access-Control-Allow-Headers'], 'OPTIONS debe emitir Allow-Headers');
    assert.ok(r.res.headers['Access-Control-Allow-Methods'], 'OPTIONS debe emitir Allow-Methods');
}

// 7) Array vacío: no permite nada
{
    const mw = createCorsMiddleware([]);
    const r = await runMw(mw, mockReq({ origin: 'https://any.com' }));
    assert.strictEqual(r.res.headers['Access-Control-Allow-Origin'], undefined);
}

// 8) Wildcard explícito
{
    const mw = createCorsMiddleware(['*']);
    const r = await runMw(mw, mockReq({ origin: 'https://any.com' }));
    assert.strictEqual(r.res.headers['Access-Control-Allow-Origin'], 'https://any.com',
        'Con *, debe devolver el origin concreto (no "*") porque la app usa credenciales');
}

console.log('Todos los tests de CORS pasaron ✅');
process.exit(0);