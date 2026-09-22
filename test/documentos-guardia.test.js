/**
 * Tests de la ruta anidada /:guardiaId/documentos de guardias.js. Ejecutar:
 * node test/documentos-guardia.test.js
 *
 * Espejo de test/documentos.test.js (documentos de registro) adaptado a
 * guardia_id — misma logica de subida/descarga/borrado y misma defensa
 * anti path-traversal, reusando el helper compartido src/lib/uploads.js.
 * La proteccion IDOR de :guardiaId (router.param -> ownsGuardia) se prueba
 * aparte en test/ownership.test.js.
 */
const assert = require('assert');
const fs = require('fs');

let pass = 0, fail = 0;
async function testAsync(name, fn) {
    try { await fn(); console.log('  OK   ' + name); pass++; }
    catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); fail++; }
}

const pool = require('../src/db/pool');
const guardiasRouter = require('../src/routes/guardias.js');

function findHandler(router, method, path_) {
    const layer = router.stack.find(l =>
        l.route && l.route.path === path_ && l.route.methods[method.toLowerCase()]
    );
    if (!layer) throw new Error('handler no encontrado para ' + method + ' ' + path_);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeRes() {
    return {
        _headers: {},
        status(c) { this._status = c; return this; },
        json(b) { this._body = b; return this; },
        send() { return this; },
        setHeader(k, v) { this._headers[k] = v; },
        sendFile(p) { this._sentFile = p; }
    };
}

async function run() {

console.log('\n== /:guardiaId/documentos ==');

await testAsync('GET /:guardiaId/documentos lista filtrando por guardia_id', async () => {
    const handler = findHandler(guardiasRouter, 'get', '/:guardiaId/documentos');
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return { rows: [
        { id: 1, guardia_id: 5, nombre_archivo: 'a.pdf', tipo_mime: 'application/pdf', fecha_agregado: 1000, url_remota: null }
    ] }; };
    const req = { params: { guardiaId: '5' }, protocol: 'https', get: () => 'api.example.com' };
    const res = fakeRes();
    await handler(req, res);
    assert.deepStrictEqual(seenParams, ['5']);
    assert.strictEqual(res._body[0].guardia_id, 5);
    assert.ok(res._body[0].url_remota.includes('/v1/guardias/5/documentos/1/file'));
});

await testAsync('POST /:guardiaId/documentos sin fichero -> 400', async () => {
    const handler = findHandler(guardiasRouter, 'post', '/:guardiaId/documentos');
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { file: null, params: { guardiaId: '5' }, protocol: 'https', get: () => 'api.example.com' };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0);
});

await testAsync('POST /:guardiaId/documentos con fichero valido -> 201, inserta+renombra en disco', async () => {
    const handler = findHandler(guardiasRouter, 'post', '/:guardiaId/documentos');
    const origRename = fs.renameSync;
    let renameArgs = null;
    fs.renameSync = (from, to) => { renameArgs = [from, to]; };
    let updateCalls = 0;
    let insertParams = null;
    pool.query = async (sql, params) => {
        if (/INSERT/.test(sql)) { insertParams = params; return { rows: [{ id: 42, guardia_id: 5 }] }; }
        if (/UPDATE/.test(sql)) { updateCalls++; return { rows: [] }; }
        return { rows: [] };
    };
    const req = {
        file: { originalname: 'contrato.pdf', mimetype: 'application/pdf', path: '/tmp/fake-upload-123' },
        params: { guardiaId: '5' }, protocol: 'https', get: () => 'api.example.com'
    };
    const res = fakeRes();
    try {
        await handler(req, res);
        assert.strictEqual(res._status, 201);
        assert.strictEqual(insertParams[0], '5');
        assert.strictEqual(insertParams[1], 'contrato.pdf');
        assert.strictEqual(insertParams[2], 'application/pdf');
        assert.ok(renameArgs, 'debe renombrar el fichero temporal al nombre final en disco');
        assert.ok(renameArgs[1].endsWith('42.pdf'));
        assert.ok(res._body.url_remota.includes('/v1/guardias/5/documentos/42/file'));
        assert.strictEqual(updateCalls, 1, 'solo debe actualizar url_remota UNA vez');
    } finally {
        fs.renameSync = origRename;
    }
});

await testAsync('POST /:guardiaId/documentos con error tras subir -> 500, borra el temporal', async () => {
    const handler = findHandler(guardiasRouter, 'post', '/:guardiaId/documentos');
    let unlinkedPath = null;
    const origUnlink = fs.unlink;
    fs.unlink = (p, cb) => { unlinkedPath = p; cb(); };
    pool.query = async () => { throw new Error('boom'); };
    const req = {
        file: { originalname: 'contrato.pdf', mimetype: 'application/pdf', path: '/tmp/fake-upload-456' },
        params: { guardiaId: '5' }, protocol: 'https', get: () => 'api.example.com'
    };
    const res = fakeRes();
    try {
        await handler(req, res);
        assert.strictEqual(res._status, 500);
        assert.strictEqual(unlinkedPath, '/tmp/fake-upload-456');
    } finally {
        fs.unlink = origUnlink;
    }
});

await testAsync('GET /:guardiaId/documentos/:docId/file con docId no numerico -> 400', async () => {
    const handler = findHandler(guardiasRouter, 'get', '/:guardiaId/documentos/:docId/file');
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { params: { guardiaId: '5', docId: 'DROP TABLE documentos_guardia' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0);
});

await testAsync('GET /:guardiaId/documentos/:docId/file de una guardia ajena -> 404 (IDOR)', async () => {
    const handler = findHandler(guardiasRouter, 'get', '/:guardiaId/documentos/:docId/file');
    pool.query = async () => ({ rows: [] });
    const req = { params: { guardiaId: '5', docId: '1' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 404);
    assert.strictEqual(res._sentFile, undefined);
});

await testAsync('GET /:guardiaId/documentos/:docId/file existente -> sirve con headers de seguridad', async () => {
    const handler = findHandler(guardiasRouter, 'get', '/:guardiaId/documentos/:docId/file');
    pool.query = async () => ({ rows: [{ id: 1, guardia_id: 5, nombre_archivo: 'contrato.pdf', tipo_mime: 'application/pdf' }] });
    const origExists = fs.existsSync;
    fs.existsSync = () => true;
    const req = { params: { guardiaId: '5', docId: '1' } };
    const res = fakeRes();
    try {
        await handler(req, res);
        assert.ok(res._sentFile);
        assert.ok(res._sentFile.endsWith('1.pdf'));
        assert.strictEqual(res._headers['Content-Type'], 'application/pdf');
        assert.strictEqual(res._headers['X-Content-Type-Options'], 'nosniff');
        assert.ok(res._headers['Content-Disposition'].includes('contrato.pdf'));
    } finally {
        fs.existsSync = origExists;
    }
});

await testAsync('GET /:guardiaId/documentos/:docId/file con tipo_mime fuera de whitelist -> octet-stream', async () => {
    const handler = findHandler(guardiasRouter, 'get', '/:guardiaId/documentos/:docId/file');
    pool.query = async () => ({ rows: [{ id: 1, guardia_id: 5, nombre_archivo: 'raro.xyz', tipo_mime: 'application/x-nunca-visto' }] });
    const origExists = fs.existsSync;
    fs.existsSync = () => true;
    const req = { params: { guardiaId: '5', docId: '1' } };
    const res = fakeRes();
    try {
        await handler(req, res);
        assert.strictEqual(res._headers['Content-Type'], 'application/octet-stream');
    } finally {
        fs.existsSync = origExists;
    }
});

await testAsync('GET /:guardiaId/documentos/:docId/file cuyo fichero ya no existe -> 404', async () => {
    const handler = findHandler(guardiasRouter, 'get', '/:guardiaId/documentos/:docId/file');
    pool.query = async () => ({ rows: [{ id: 1, guardia_id: 5, nombre_archivo: 'contrato.pdf', tipo_mime: 'application/pdf' }] });
    const origExists = fs.existsSync;
    fs.existsSync = () => false;
    const req = { params: { guardiaId: '5', docId: '1' } };
    const res = fakeRes();
    try {
        await handler(req, res);
        assert.strictEqual(res._status, 404);
    } finally {
        fs.existsSync = origExists;
    }
});

await testAsync('DELETE /:guardiaId/documentos/:docId con docId no numerico -> 400', async () => {
    const handler = findHandler(guardiasRouter, 'delete', '/:guardiaId/documentos/:docId');
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { params: { guardiaId: '5', docId: '-1' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0);
});

await testAsync('DELETE /:guardiaId/documentos/:docId existente -> 204 y borra el fichero en disco', async () => {
    const handler = findHandler(guardiasRouter, 'delete', '/:guardiaId/documentos/:docId');
    let unlinkedPath = null;
    const origUnlink = fs.unlink;
    fs.unlink = (p, cb) => { unlinkedPath = p; cb(); };
    pool.query = async () => ({ rows: [{ id: 1, guardia_id: 5, nombre_archivo: 'contrato.pdf' }] });
    const req = { params: { guardiaId: '5', docId: '1' } };
    const res = fakeRes();
    try {
        await handler(req, res);
        assert.strictEqual(res._status, 204);
        assert.ok(unlinkedPath && unlinkedPath.endsWith('1.pdf'));
    } finally {
        fs.unlink = origUnlink;
    }
});

await testAsync('DELETE /:guardiaId/documentos/:docId de una guardia ajena -> 204 sin filas afectadas', async () => {
    const handler = findHandler(guardiasRouter, 'delete', '/:guardiaId/documentos/:docId');
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return { rows: [] }; };
    const req = { params: { guardiaId: '5', docId: '1' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 204);
    assert.deepStrictEqual(seenParams, ['1', '5']);
});

await testAsync('DELETE /:guardiaId/documentos/:docId con pool.query lanzando -> 500', async () => {
    const handler = findHandler(guardiasRouter, 'delete', '/:guardiaId/documentos/:docId');
    pool.query = async () => { throw new Error('boom'); };
    const req = { params: { guardiaId: '5', docId: '1' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 500);
});

console.log('\n' + (fail === 0 ? 'TODOS OK' : 'HAY FALLOS') + ' — pass: ' + pass + ', fail: ' + fail);
process.exit(fail === 0 ? 0 : 1);

}

run();
