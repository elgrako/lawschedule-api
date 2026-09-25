/**
 * Tests de rutas (documentos.js). Ejecutar: node test/documentos.test.js
 * Sin cobertura previa. La proteccion IDOR de :registroId (ownsRegistro montado en
 * app.js) se prueba aparte en test/ownership.test.js; aqui se prueba la logica propia
 * del router (mergeParams). El contenido del fichero se guarda como BYTEA en la
 * propia fila (Postgres/Neon), no en disco -- Render es efimero y se borra en
 * cada redeploy, asi que no hay ningun estado local que probar aqui.
 */
const assert = require('assert');

let pass = 0, fail = 0;
function test(name, fn) {
    try { fn(); console.log('  OK   ' + name); pass++; }
    catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); fail++; }
}
async function testAsync(name, fn) {
    try { await fn(); console.log('  OK   ' + name); pass++; }
    catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); fail++; }
}

const pool = require('../src/db/pool');
const documentosRouter = require('../src/routes/documentos.js');

// documentos.js define POST '/' con dos middlewares (upload.single, luego el handler):
// el handler real es siempre el ULTIMO de la pila de la ruta.
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
        send(b) { this._sentBody = b; return this; },
        setHeader(k, v) { this._headers[k] = v; }
    };
}

async function run() {

console.log('\n== routes: documentos.js ==');

await testAsync('GET / lista documentos filtrando por registro_id (de la URL, ya verificado por ownsRegistro)', async () => {
    const handler = findHandler(documentosRouter, 'get', '/');
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return { rows: [
        { id: 1, registro_id: 5, nombre_archivo: 'a.pdf', tipo_mime: 'application/pdf', fecha_agregado: 1000, url_remota: null }
    ] }; };
    const req = { params: { registroId: '5' }, protocol: 'https', get: () => 'api.example.com' };
    const res = fakeRes();
    await handler(req, res);
    assert.deepStrictEqual(seenParams, ['5']);
    assert.strictEqual(res._body[0].registro_id, 5);
    assert.ok(res._body[0].url_remota.includes('/v1/registros/5/documentos/1/file'));
});

await testAsync('POST / sin fichero -> 400', async () => {
    const handler = findHandler(documentosRouter, 'post', '/');
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { file: null, params: { registroId: '5' }, protocol: 'https', get: () => 'api.example.com' };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0);
});

await testAsync('POST / con fichero valido -> 201, inserta el contenido como BYTEA y actualiza url_remota UNA sola vez', async () => {
    const handler = findHandler(documentosRouter, 'post', '/');
    let updateCalls = 0;
    let insertParams = null;
    pool.query = async (sql, params) => {
        if (/INSERT/.test(sql)) { insertParams = params; return { rows: [{ id: 42, registro_id: 5 }] }; }
        if (/UPDATE/.test(sql)) { updateCalls++; return { rows: [] }; }
        return { rows: [] };
    };
    const fileBuffer = Buffer.from('contenido-fake-pdf');
    const req = {
        file: { originalname: 'contrato.pdf', mimetype: 'application/pdf', buffer: fileBuffer },
        params: { registroId: '5' }, protocol: 'https', get: () => 'api.example.com'
    };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 201);
    assert.strictEqual(insertParams[0], '5');
    assert.strictEqual(insertParams[1], 'contrato.pdf');
    assert.strictEqual(insertParams[2], 'application/pdf');
    assert.strictEqual(insertParams[4], fileBuffer, 'debe insertar el Buffer del fichero tal cual como BYTEA');
    assert.ok(res._body.url_remota.includes('/v1/registros/5/documentos/42/file'));
    assert.strictEqual(updateCalls, 1,
        'solo debe actualizar url_remota UNA vez (regresion: antes se llamaba dos veces con los mismos parametros)');
});

await testAsync('POST / con error de BD -> 500', async () => {
    const handler = findHandler(documentosRouter, 'post', '/');
    pool.query = async () => { throw new Error('boom'); };
    const req = {
        file: { originalname: 'contrato.pdf', mimetype: 'application/pdf', buffer: Buffer.from('x') },
        params: { registroId: '5' }, protocol: 'https', get: () => 'api.example.com'
    };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 500);
});

await testAsync('GET /:docId/file con docId no numerico -> 400, sin llegar a la BD', async () => {
    const handler = findHandler(documentosRouter, 'get', '/:docId/file');
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { params: { registroId: '5', docId: 'DROP TABLE documentos_registro' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0, 'no debe consultar la BD con un docId malformado');
});

await testAsync('GET /:docId/file de un registro ajeno -> 404, no sirve el contenido (IDOR)', async () => {
    const handler = findHandler(documentosRouter, 'get', '/:docId/file');
    pool.query = async () => ({ rows: [] }); // id=docId AND registro_id=registroId no matchea
    const req = { params: { registroId: '5', docId: '1' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 404);
    assert.strictEqual(res._sentBody, undefined);
});

await testAsync('GET /:docId/file cuya fila no tiene contenido guardado -> 404', async () => {
    const handler = findHandler(documentosRouter, 'get', '/:docId/file');
    pool.query = async () => ({ rows: [{ nombre_archivo: 'contrato.pdf', tipo_mime: 'application/pdf', contenido: null }] });
    const req = { params: { registroId: '5', docId: '1' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 404);
});

await testAsync('GET /:docId/file existente -> sirve el contenido (BYTEA) con headers de seguridad y mime whitelisteado', async () => {
    const handler = findHandler(documentosRouter, 'get', '/:docId/file');
    const fileBuffer = Buffer.from('contenido-fake-pdf');
    pool.query = async () => ({ rows: [{ nombre_archivo: 'contrato.pdf', tipo_mime: 'application/pdf', contenido: fileBuffer }] });
    const req = { params: { registroId: '5', docId: '1' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._sentBody, fileBuffer, 'debe enviar el Buffer tal cual');
    assert.strictEqual(res._headers['Content-Type'], 'application/pdf');
    assert.strictEqual(res._headers['X-Content-Type-Options'], 'nosniff');
    assert.ok(res._headers['Content-Disposition'].includes('contrato.pdf'));
});

await testAsync('GET /:docId/file con tipo_mime fuera de whitelist -> sirve como application/octet-stream', async () => {
    const handler = findHandler(documentosRouter, 'get', '/:docId/file');
    pool.query = async () => ({ rows: [{ nombre_archivo: 'raro.xyz', tipo_mime: 'application/x-nunca-visto', contenido: Buffer.from('x') } ] });
    const req = { params: { registroId: '5', docId: '1' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._headers['Content-Type'], 'application/octet-stream',
        'un tipo_mime no whitelisteado nunca debe servirse tal cual');
});

await testAsync('DELETE /:docId con docId no numerico -> 400, sin llegar a la BD', async () => {
    const handler = findHandler(documentosRouter, 'delete', '/:docId');
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { params: { registroId: '5', docId: '-1' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0, 'no debe consultar la BD con un docId malformado');
});

await testAsync('DELETE /:docId existente -> 204', async () => {
    const handler = findHandler(documentosRouter, 'delete', '/:docId');
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return { rows: [] }; };
    const req = { params: { registroId: '5', docId: '1' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 204);
    assert.deepStrictEqual(seenParams, ['1', '5']);
});

await testAsync('DELETE con pool.query lanzando -> 500', async () => {
    const handler = findHandler(documentosRouter, 'delete', '/:docId');
    pool.query = async () => { throw new Error('boom'); };
    const req = { params: { registroId: '5', docId: '1' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 500);
});

console.log('\n' + (fail === 0 ? 'TODOS OK' : 'HAY FALLOS') + ' — pass: ' + pass + ', fail: ' + fail);
process.exit(fail === 0 ? 0 : 1);

}

run();
