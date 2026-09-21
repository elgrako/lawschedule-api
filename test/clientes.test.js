/**
 * Tests de rutas (clientes.js). Ejecutar: node test/clientes.test.js
 * Mismo estilo que test/registros.test.js: handlers invocados directamente,
 * pool.query mockeado.
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

function findHandler(router, method, path) {
    const layer = router.stack.find(l =>
        l.route && l.route.path === path && l.route.methods[method.toLowerCase()]
    );
    if (!layer) throw new Error('handler no encontrado para ' + method + ' ' + path);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeRes() {
    return {
        status(c) { this._status = c; return this; },
        json(b) { this._body = b; return this; },
        send() { return this; }
    };
}

async function run() {

console.log('\n== routes: clientes.js ==');
const clientesRouter = require('../src/routes/clientes.js');

await testAsync('GET / con user distinto de req.userId -> 403 (IDOR)', async () => {
    const handler = findHandler(clientesRouter, 'get', '/');
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { query: { user: '99' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 403);
    assert.strictEqual(calls, 0, 'no debe consultar la BD si el usuario no coincide');
});

await testAsync('GET / propio -> 200, filtra por usuario_id, ordena por nombre', async () => {
    const handler = findHandler(clientesRouter, 'get', '/');
    let seenSql = null, seenParams = null;
    pool.query = async (sql, params) => {
        seenSql = sql; seenParams = params;
        return { rows: [{ id: 1, nombre: 'Ana', dni_nif: '123X', email: 'a@a.com',
            telefono: '600', direccion: 'Calle 1', notas: null, usuario_id: 7 }] };
    };
    const req = { query: {}, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.deepStrictEqual(seenParams, [7]);
    assert.ok(/ORDER BY nombre/.test(seenSql));
    assert.strictEqual(res._body[0].nombre, 'Ana');
    assert.strictEqual(res._body[0].dniNif, '123X');
});

await testAsync('GET / con pool.query lanzando -> 500', async () => {
    const handler = findHandler(clientesRouter, 'get', '/');
    pool.query = async () => { throw new Error('conexion perdida'); };
    const req = { query: {}, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 500);
});

await testAsync('POST / sin nombre -> 400, sin llegar a la BD', async () => {
    const handler = findHandler(clientesRouter, 'post', '/');
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { body: {}, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0);
});

await testAsync('POST / con nombre solo espacios -> 400 (V.str recorta y rechaza vacio)', async () => {
    const handler = findHandler(clientesRouter, 'post', '/');
    const req = { body: { nombre: '   ' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
});

await testAsync('POST / con nombre con forma de inyeccion SQL -> insertado como dato parametrizado, no ejecutado', async () => {
    const handler = findHandler(clientesRouter, 'post', '/');
    let seenParams = null;
    pool.query = async (sql, params) => {
        seenParams = params;
        assert.ok(!sql.includes('DROP TABLE'), 'el nombre no debe concatenarse en el SQL');
        return { rows: [{ id: 2, nombre: params[0], dni_nif: null, email: null, telefono: null,
            direccion: null, notas: null, usuario_id: 7 }] };
    };
    const req = { body: { nombre: "Robert'); DROP TABLE clientes;--" }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 201);
    assert.strictEqual(seenParams[0], "Robert'); DROP TABLE clientes;--");
});

await testAsync('POST / usa siempre req.userId, ignora usuario_id del body (anti-IDOR en creacion)', async () => {
    const handler = findHandler(clientesRouter, 'post', '/');
    let seenParams = null;
    pool.query = async (sql, params) => {
        seenParams = params;
        return { rows: [{ id: 3, usuario_id: 7, nombre: 'X', dni_nif: null, email: null,
            telefono: null, direccion: null, notas: null }] };
    };
    const req = { body: { nombre: 'X', usuario_id: 999 }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(seenParams[seenParams.length - 1], 7,
        'el usuario_id insertado debe ser req.userId, no el del body');
});

await testAsync('PUT /:id con id no numerico -> 400', async () => {
    const handler = findHandler(clientesRouter, 'put', '/:id');
    const req = { params: { id: 'abc' }, body: { nombre: 'X' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
});

await testAsync('PUT /:id sin nombre -> 400', async () => {
    const handler = findHandler(clientesRouter, 'put', '/:id');
    const req = { params: { id: '10' }, body: {}, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
});

await testAsync('PUT /:id de OTRO usuario -> 404 y NO devuelve datos (IDOR)', async () => {
    const handler = findHandler(clientesRouter, 'put', '/:id');
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return { rows: [] }; };
    const req = { params: { id: '10' }, body: { nombre: 'X' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 404);
    assert.strictEqual(res._body.nombre, undefined, 'no debe filtrarse ningun dato');
    assert.strictEqual(seenParams[seenParams.length - 1], 7,
        'debe filtrar por req.userId, no por un usuario del body');
});

await testAsync('PUT /:id propio -> 200 con datos actualizados', async () => {
    const handler = findHandler(clientesRouter, 'put', '/:id');
    pool.query = async () => ({ rows: [{ id: 10, nombre: 'Actualizado', dni_nif: null,
        email: null, telefono: null, direccion: null, notas: null, usuario_id: 7 }] });
    const req = { params: { id: '10' }, body: { nombre: 'Actualizado' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, undefined, 'exito usa res.json() sin .status() -> 200 implicito');
    assert.strictEqual(res._body.nombre, 'Actualizado');
});

await testAsync('DELETE /:id con id no numerico -> 400', async () => {
    const handler = findHandler(clientesRouter, 'delete', '/:id');
    let calls = 0;
    pool.query = async () => { calls++; return {}; };
    const req = { params: { id: '-1' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0);
});

await testAsync('DELETE /:id propio -> 204, filtra por id Y usuario_id', async () => {
    const handler = findHandler(clientesRouter, 'delete', '/:id');
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return {}; };
    const req = { params: { id: '10' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 204);
    assert.deepStrictEqual(seenParams, ['10', 7]);
});

await testAsync('DELETE /:id con pool.query lanzando -> 500', async () => {
    const handler = findHandler(clientesRouter, 'delete', '/:id');
    pool.query = async () => { throw new Error('boom'); };
    const req = { params: { id: '10' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 500);
});

console.log('\n' + (fail === 0 ? 'TODOS OK' : 'HAY FALLOS') + ' — pass: ' + pass + ', fail: ' + fail);
process.exit(fail === 0 ? 0 : 1);

}

run();
