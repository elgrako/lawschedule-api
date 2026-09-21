/**
 * Tests de rutas (registros.js). Ejecutar: node test/registros.test.js
 * Sin cobertura previa: este fichero no tenia NINGUN test. Mismo estilo que
 * test/routes.test.js: handlers invocados directamente, pool.query mockeado.
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

console.log('\n== routes: registros.js ==');
const registrosRouter = require('../src/routes/registros.js');

await testAsync('GET / con user distinto de req.userId -> 403 (IDOR)', async () => {
    const handler = findHandler(registrosRouter, 'get', '/');
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { query: { user: '99' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 403);
    assert.strictEqual(calls, 0, 'no debe consultar la BD si el usuario no coincide');
});

await testAsync('GET / propio -> 200, filtra por usuario_id', async () => {
    const handler = findHandler(registrosRouter, 'get', '/');
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return { rows: [
        { id: 1, nombre: 'Ana', dni: '123', n_expediente: 'E1', euros: 100, email: 'a@a.com',
          telefono: '600', presentado: true, validado: false, pagado: false, n_talon: null,
          comentarios: null, estado: 'PENDIENTE', usuario_id: 7 }
    ] }; };
    const req = { query: {}, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.deepStrictEqual(seenParams, [7]);
    assert.strictEqual(res._body[0].nombre, 'Ana');
    assert.strictEqual(res._body[0].usuario_id, 7);
});

await testAsync('GET / con pool.query lanzando -> 500', async () => {
    const handler = findHandler(registrosRouter, 'get', '/');
    pool.query = async () => { throw new Error('conexion perdida'); };
    const req = { query: {}, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 500);
});

await testAsync('POST / sin nombre -> 400, sin llegar a la BD', async () => {
    const handler = findHandler(registrosRouter, 'post', '/');
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { body: {}, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0);
});

await testAsync('POST / con nombre solo espacios -> 400 (V.str recorta y rechaza vacio)', async () => {
    const handler = findHandler(registrosRouter, 'post', '/');
    const req = { body: { nombre: '   ' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
});

await testAsync('POST / con nombre con forma de inyeccion SQL -> insertado como dato parametrizado, no ejecutado', async () => {
    const handler = findHandler(registrosRouter, 'post', '/');
    let seenParams = null;
    pool.query = async (sql, params) => {
        seenParams = params;
        assert.ok(!sql.includes("DROP TABLE"), 'el nombre no debe concatenarse en el SQL');
        return { rows: [{ id: 2, nombre: params[0], dni: null, n_expediente: null, euros: 0,
            email: null, telefono: null, presentado: false, validado: false, pagado: false,
            n_talon: null, comentarios: null, estado: 'PENDIENTE', usuario_id: 7 }] };
    };
    const req = { body: { nombre: "Robert'); DROP TABLE registros;--" }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 201);
    assert.strictEqual(seenParams[0], "Robert'); DROP TABLE registros;--");
});

await testAsync('POST / usa siempre req.userId, ignora usuario_id del body (anti-IDOR en creacion)', async () => {
    const handler = findHandler(registrosRouter, 'post', '/');
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return { rows: [{ id: 3, usuario_id: 7,
        nombre: 'X', dni: null, n_expediente: null, euros: 0, email: null, telefono: null,
        presentado: false, validado: false, pagado: false, n_talon: null, comentarios: null, estado: 'PENDIENTE' }] };
    };
    const req = { body: { nombre: 'X', usuario_id: 999 }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(seenParams[seenParams.length - 1], 7, 'el usuario_id insertado debe ser req.userId, no el del body');
});

await testAsync('POST / con clienteId malformado -> se inserta como NULL, sin consultar clientes', async () => {
    const handler = findHandler(registrosRouter, 'post', '/');
    let calls = 0;
    let seenParams = null;
    pool.query = async (sql, params) => {
        calls++;
        seenParams = params;
        return { rows: [{ id: 4, usuario_id: 7, nombre: 'X', cliente_id: null }] };
    };
    const req = { body: { nombre: 'X', clienteId: 'no-es-un-id' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(calls, 1, 'clienteId invalido no debe generar una consulta extra a clientes');
    assert.strictEqual(seenParams[12], null, 'clienteId invalido se inserta como NULL');
});

await testAsync('POST / con clienteId de OTRO usuario -> se inserta como NULL (anti-IDOR)', async () => {
    const handler = findHandler(registrosRouter, 'post', '/');
    let insertParams = null;
    pool.query = async (sql, params) => {
        if (/SELECT id FROM clientes/.test(sql)) return { rows: [] }; // no pertenece a req.userId
        insertParams = params;
        return { rows: [{ id: 4, usuario_id: 7, nombre: 'X', cliente_id: null }] };
    };
    const req = { body: { nombre: 'X', clienteId: '999' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(insertParams[12], null, 'un clienteId ajeno nunca debe enlazarse, ni exponerse su existencia');
});

await testAsync('POST / con clienteId propio -> se enlaza correctamente', async () => {
    const handler = findHandler(registrosRouter, 'post', '/');
    let insertParams = null;
    pool.query = async (sql, params) => {
        if (/SELECT id FROM clientes/.test(sql)) {
            assert.deepStrictEqual(params, [5, 7], 'debe verificar que el cliente pertenece a req.userId');
            return { rows: [{ id: 5 }] };
        }
        insertParams = params;
        return { rows: [{ id: 4, usuario_id: 7, nombre: 'X', cliente_id: 5 }] };
    };
    const req = { body: { nombre: 'X', clienteId: '5' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(insertParams[12], 5);
    assert.strictEqual(res._body.clienteId, 5);
});

await testAsync('PUT /:id con id no numerico -> 400', async () => {
    const handler = findHandler(registrosRouter, 'put', '/:id');
    const req = { params: { id: 'abc' }, body: { nombre: 'X' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
});

await testAsync('PUT /:id de OTRO usuario -> 404 y NO devuelve datos (IDOR)', async () => {
    const handler = findHandler(registrosRouter, 'put', '/:id');
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return { rows: [] }; }; // WHERE usuario_id=req.userId no matchea
    const req = { params: { id: '10' }, body: { nombre: 'X' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 404);
    assert.strictEqual(res._body.nombre, undefined, 'no debe filtrarse ningun dato');
    assert.strictEqual(seenParams[seenParams.length - 1], 7, 'debe filtrar por req.userId, no por un usuario del body');
});

await testAsync('PUT /:id propio -> 200 con datos actualizados', async () => {
    const handler = findHandler(registrosRouter, 'put', '/:id');
    pool.query = async () => ({ rows: [{ id: 10, nombre: 'Actualizado', dni: null, n_expediente: null,
        euros: 0, email: null, telefono: null, presentado: false, validado: false, pagado: false,
        n_talon: null, comentarios: null, estado: 'PENDIENTE', usuario_id: 7 }] });
    const req = { params: { id: '10' }, body: { nombre: 'Actualizado' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, undefined, 'exito usa res.json() sin .status() -> 200 implicito');
    assert.strictEqual(res._body.nombre, 'Actualizado');
});

await testAsync('DELETE /:id con id no numerico -> 400', async () => {
    const handler = findHandler(registrosRouter, 'delete', '/:id');
    let calls = 0;
    pool.query = async () => { calls++; return {}; };
    const req = { params: { id: '-1' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0);
});

await testAsync('DELETE /:id propio -> 204, filtra por id Y usuario_id', async () => {
    const handler = findHandler(registrosRouter, 'delete', '/:id');
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return {}; };
    const req = { params: { id: '10' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 204);
    assert.deepStrictEqual(seenParams, ['10', 7]);
});

await testAsync('DELETE /:id con pool.query lanzando -> 500', async () => {
    const handler = findHandler(registrosRouter, 'delete', '/:id');
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
