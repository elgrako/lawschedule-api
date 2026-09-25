/**
 * Tests de rutas (guardias.js y dias-guardia.js). Ejecutar: node test/routes.test.js
 * No requiere BD ni servidor HTTP: se invocan los handlers de Express directamente
 * como funciones, mockeando pool.query. Mismo estilo que test/security.test.js.
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

// Recorre router.stack buscando el layer de una ruta simple (sin sub-routers)
// y devuelve el handler real (la funcion async (req,res)=>{...}).
function findHandler(router, method, path) {
    const layer = router.stack.find(l =>
        l.route && l.route.path === path && l.route.methods[method.toLowerCase()]
    );
    if (!layer) throw new Error('handler no encontrado para ' + method + ' ' + path);
    return layer.route.stack[0].handle;
}

function fakeRes() {
    return {
        status(c) { this._status = c; return this; },
        json(b) { this._body = b; return this; },
        send() { return this; }
    };
}

async function run() {

console.log('\n== routes: guardias.js ==');
const guardiasRouter = require('../src/routes/guardias.js');

await testAsync('GET / con user distinto de req.userId -> 403', async () => {
    const handler = findHandler(guardiasRouter, 'get', '/');
    const req = { query: { user: '99' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 403);
});

await testAsync('GET / propio -> 200, lista mapeada filtrando por usuario_id', async () => {
    const handler = findHandler(guardiasRouter, 'get', '/');
    let seenParams = null;
    pool.query = async (sql, params) => {
        seenParams = params;
        return { rows: [{ id: 1, dia_guardia_id: 5, nombre_asistido: 'Juan', cobrado: true,
                           observaciones_asistido: null, usuario_id: 7 }] };
    };
    const req = { query: {}, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.deepStrictEqual(seenParams, [7]);
    assert.strictEqual(res._body[0].nombreAsistido, 'Juan');
    assert.strictEqual(res._body[0].cobrado, true);
});

await testAsync('POST / sin diaGuardiaId valido en el body -> 400', async () => {
    const handler = findHandler(guardiasRouter, 'post', '/');
    const req = { body: {}, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
});

await testAsync('POST / con diaGuardiaId invalido (no numerico) -> 400', async () => {
    const handler = findHandler(guardiasRouter, 'post', '/');
    const req = { body: { diaGuardiaId: 'abc' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
});

await testAsync('POST / con diaGuardiaId ajeno -> 404 y sin INSERT', async () => {
    const handler = findHandler(guardiasRouter, 'post', '/');
    let calls = 0;
    pool.query = async (sql, params) => { calls++; return { rows: [] }; };
    const req = { body: { diaGuardiaId: '5' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 404);
    assert.strictEqual(res._body.error, 'Dia de guardia no encontrado');
    assert.strictEqual(calls, 1, 'el INSERT no deberia haberse ejecutado');
});

await testAsync('POST / con diaGuardiaId valido -> 201, DTO sin diaActuacion/juzgado', async () => {
    const handler = findHandler(guardiasRouter, 'post', '/');
    let call = 0;
    pool.query = async (sql, params) => {
        call++;
        if (call === 1) return { rows: [{}] }; // ownership OK
        return {
            rows: [{
                id: 1, dia_guardia_id: 5, nombre_asistido: 'Juan',
                cobrado: false, observaciones_asistido: null, usuario_id: 7
            }]
        };
    };
    const req = { body: { diaGuardiaId: '5', nombreAsistido: 'Juan' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 201);
    assert.strictEqual(res._body.id, 1);
    assert.strictEqual(res._body.diaGuardiaId, 5);
    assert.strictEqual(res._body.nombreAsistido, 'Juan');
    assert.strictEqual(res._body.cobrado, false);
    assert.strictEqual(res._body.usuario_id, 7);
    assert.strictEqual(res._body.diaActuacion, undefined, 'el DTO viejo no deberia resucitar (diaActuacion)');
    assert.strictEqual(res._body.juzgado, undefined, 'el DTO viejo no deberia resucitar (juzgado)');
    assert.strictEqual(call, 2, 'debe llamarse ownership + INSERT');
});

await testAsync('PUT /:id con id no numerico -> 400', async () => {
    const handler = findHandler(guardiasRouter, 'put', '/:id');
    const req = { params: { id: 'abc' }, body: { diaGuardiaId: '5' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
});

await testAsync('PUT /:id con diaGuardiaId ajeno -> 404, sin UPDATE', async () => {
    const handler = findHandler(guardiasRouter, 'put', '/:id');
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; }; // ownership del dia falla
    const req = { params: { id: '1' }, body: { diaGuardiaId: '5' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 404);
    assert.strictEqual(calls, 1, 'no debe llegar al UPDATE si el diaGuardiaId no es del usuario');
});

await testAsync('PUT /:id propio -> 200 con datos actualizados', async () => {
    const handler = findHandler(guardiasRouter, 'put', '/:id');
    let call = 0;
    pool.query = async () => {
        call++;
        if (call === 1) return { rows: [{}] }; // ownership OK
        return { rows: [{ id: 1, dia_guardia_id: 5, nombre_asistido: 'Ana', cobrado: false,
                           observaciones_asistido: null, usuario_id: 7 }] };
    };
    const req = { params: { id: '1' }, body: { diaGuardiaId: '5', nombreAsistido: 'Ana' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, undefined); // res.json() implicito -> 200
    assert.strictEqual(res._body.nombreAsistido, 'Ana');
});

await testAsync('PUT /:id propio pero fila no encontrada (usuario_id no coincide) -> 404', async () => {
    const handler = findHandler(guardiasRouter, 'put', '/:id');
    let call = 0;
    pool.query = async () => {
        call++;
        if (call === 1) return { rows: [{}] }; // ownership del dia OK
        return { rows: [] }; // pero el UPDATE no matchea id+usuario_id
    };
    const req = { params: { id: '1' }, body: { diaGuardiaId: '5' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 404);
});

await testAsync('DELETE /:id con id no numerico -> 400', async () => {
    const handler = findHandler(guardiasRouter, 'delete', '/:id');
    const req = { params: { id: 'abc' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
});

await testAsync('DELETE /:id propio -> 204, filtra por id Y usuario_id', async () => {
    const handler = findHandler(guardiasRouter, 'delete', '/:id');
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return {}; };
    const req = { params: { id: '1' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 204);
    assert.deepStrictEqual(seenParams, ['1', 7]);
});

console.log('\n== routes: dias-guardia.js ==');
const diasGuardiaRouter = require('../src/routes/dias-guardia.js');

await testAsync('POST / sin diaActuacion -> 400', async () => {
    const handler = findHandler(diasGuardiaRouter, 'post', '/');
    const req = { body: {}, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
});

await testAsync('POST / con diaActuacion en formato invalido (epoch ms) -> 400, sin llegar a la BD', async () => {
    const handler = findHandler(diasGuardiaRouter, 'post', '/');
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { body: { diaActuacion: 1735689600000 }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0, 'un formato de fecha invalido no debe llegar a Postgres (evita el 500 generico)');
});

await testAsync('POST / con diaActuacion de calendario invalida (2025-02-30) -> 400', async () => {
    const handler = findHandler(diasGuardiaRouter, 'post', '/');
    pool.query = async () => ({ rows: [] });
    const req = { body: { diaActuacion: '2025-02-30' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
});

await testAsync('POST / valido -> 201, body mapeado (camelCase + usuario_id)', async () => {
    const handler = findHandler(diasGuardiaRouter, 'post', '/');
    pool.query = async (sql, params) => ({
        rows: [{
            id: 1,
            dia_actuacion: '2025-01-01',
            por_juzgado: true,
            juzgado: 'Juzgado 1',
            telefono_juzgado: '123456789',
            agente_judicial: 'Agente X',
            juez: 'Juez Y',
            observaciones: 'obs',
            usuario_id: 7
        }]
    });
    const req = {
        body: {
            diaActuacion: '2025-01-01', porJuzgado: true, juzgado: 'Juzgado 1',
            telefonoJuzgado: '123456789', agenteJudicial: 'Agente X', juez: 'Juez Y',
            observaciones: 'obs'
        },
        userId: 7
    };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 201);
    assert.strictEqual(res._body.diaActuacion, '2025-01-01');
    assert.strictEqual(res._body.porJuzgado, true);
    assert.strictEqual(res._body.juzgado, 'Juzgado 1');
    assert.strictEqual(res._body.telefonoJuzgado, '123456789');
    assert.strictEqual(res._body.agenteJudicial, 'Agente X');
    assert.strictEqual(res._body.juez, 'Juez Y');
    assert.strictEqual(res._body.observaciones, 'obs');
    assert.strictEqual(res._body.usuario_id, req.userId);
});

await testAsync('GET / con user distinto de req.userId -> 403', async () => {
    const handler = findHandler(diasGuardiaRouter, 'get', '/');
    const req = { query: { user: '99' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 403);
});

await testAsync('GET / propio -> 200, lista mapeada filtrando por usuario_id', async () => {
    const handler = findHandler(diasGuardiaRouter, 'get', '/');
    let seenParams = null;
    pool.query = async (sql, params) => {
        seenParams = params;
        return { rows: [{ id: 1, dia_actuacion: '2025-01-01', por_juzgado: false, juzgado: null,
                           telefono_juzgado: null, agente_judicial: null, juez: null,
                           observaciones: null, usuario_id: 7 }] };
    };
    const req = { query: {}, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.deepStrictEqual(seenParams, [7]);
    assert.strictEqual(res._body[0].diaActuacion, '2025-01-01');
});

await testAsync('PUT /:id con id no numerico -> 400', async () => {
    const handler = findHandler(diasGuardiaRouter, 'put', '/:id');
    const req = { params: { id: 'abc' }, body: { diaActuacion: '2025-01-01' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
});

await testAsync('PUT /:id sin diaActuacion -> 400', async () => {
    const handler = findHandler(diasGuardiaRouter, 'put', '/:id');
    const req = { params: { id: '1' }, body: {}, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
});

await testAsync('PUT /:id propio -> 200 con datos actualizados', async () => {
    const handler = findHandler(diasGuardiaRouter, 'put', '/:id');
    pool.query = async () => ({ rows: [{ id: 1, dia_actuacion: '2025-01-01', por_juzgado: true,
        juzgado: 'J1', telefono_juzgado: null, agente_judicial: null, juez: null,
        observaciones: null, usuario_id: 7 }] });
    const req = { params: { id: '1' }, body: { diaActuacion: '2025-01-01', porJuzgado: true, juzgado: 'J1' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, undefined);
    assert.strictEqual(res._body.juzgado, 'J1');
});

await testAsync('PUT /:id ajeno (usuario_id no coincide) -> 404', async () => {
    const handler = findHandler(diasGuardiaRouter, 'put', '/:id');
    pool.query = async () => ({ rows: [] });
    const req = { params: { id: '1' }, body: { diaActuacion: '2025-01-01' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 404);
});

await testAsync('DELETE /:id con id no numerico -> 400', async () => {
    const handler = findHandler(diasGuardiaRouter, 'delete', '/:id');
    let calls = 0;
    pool.query = async () => { calls++; return {}; };
    const req = { params: { id: 'abc' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0);
});

await testAsync('DELETE /:id propio -> 204, filtra por id Y usuario_id', async () => {
    const handler = findHandler(diasGuardiaRouter, 'delete', '/:id');
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return {}; };
    const req = { params: { id: '1' }, userId: 7 };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 204);
    assert.deepStrictEqual(seenParams, ['1', 7]);
});

console.log('\n' + (fail === 0 ? 'TODOS OK' : 'HAY FALLOS') + ' — pass: ' + pass + ', fail: ' + fail);
process.exit(fail === 0 ? 0 : 1);

}

run();
