/**
 * Tests de rutas anidadas de guardias.js: situacion / apelaciones / recurso /
 * recurso_extra. Ejecutar: node test/guardias-subrecursos.test.js
 *
 * Sin cobertura previa (routes.test.js solo cubria el CRUD top-level de guardias).
 * La proteccion IDOR de :guardiaId (router.param -> ownsGuardia) se prueba aparte en
 * test/ownership.test.js; aqui se asume que ya paso ese middleware (como ocurre en
 * produccion) y se prueba la logica propia de cada sub-recurso.
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
const guardiasRouter = require('../src/routes/guardias.js');

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

for (const sub of ['situacion', 'apelaciones', 'recurso', 'recurso_extra']) {

console.log('\n== /:guardiaId/' + sub + ' ==');

await testAsync('GET lista filtrando por guardia_id', async () => {
    const handler = findHandler(guardiasRouter, 'get', '/:guardiaId/' + sub);
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return { rows: [] }; };
    const req = { params: { guardiaId: '5' } };
    const res = fakeRes();
    await handler(req, res);
    assert.deepStrictEqual(seenParams, ['5']);
    assert.deepStrictEqual(res._body, []);
});

await testAsync('GET con pool.query lanzando -> 500', async () => {
    const handler = findHandler(guardiasRouter, 'get', '/:guardiaId/' + sub);
    pool.query = async () => { throw new Error('boom'); };
    const req = { params: { guardiaId: '5' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 500);
});

await testAsync('POST inserta ligado al guardiaId de la URL (no a uno del body)', async () => {
    const handler = findHandler(guardiasRouter, 'post', '/:guardiaId/' + sub);
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return { rows: [{ id: 1, guardia_id: 5 }] }; };
    const req = { params: { guardiaId: '5' }, body: { nExpediente: 'E1', guardia_id: 999 } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 201);
    assert.strictEqual(seenParams[0], '5', 'debe usar el guardiaId de la URL, no el guardia_id del body');
});

await testAsync('PUT /:id con id no numerico -> 400, sin tocar la BD', async () => {
    const handler = findHandler(guardiasRouter, 'put', '/:guardiaId/' + sub + '/:id');
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { params: { guardiaId: '5', id: 'abc' }, body: {} };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0, 'un id con formato invalido no debe llegar a la BD');
});

await testAsync('DELETE /:id con id no numerico -> 400, sin tocar la BD', async () => {
    const handler = findHandler(guardiasRouter, 'delete', '/:guardiaId/' + sub + '/:id');
    let calls = 0;
    pool.query = async () => { calls++; return {}; };
    const req = { params: { guardiaId: '5', id: '1 OR 1=1' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0, 'un id con forma de inyeccion no debe llegar a la BD');
});

await testAsync('PUT /:id de un recurso que no pertenece a esa guardia -> 404, no filtra datos', async () => {
    const handler = findHandler(guardiasRouter, 'put', '/:guardiaId/' + sub + '/:id');
    pool.query = async () => ({ rows: [] }); // WHERE id=x AND guardia_id=y no matchea
    const req = { params: { guardiaId: '5', id: '77' }, body: {} };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 404);
});

await testAsync('PUT /:id propio de la guardia -> 200', async () => {
    const handler = findHandler(guardiasRouter, 'put', '/:guardiaId/' + sub + '/:id');
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return { rows: [{ id: 77, guardia_id: 5 }] }; };
    const req = { params: { guardiaId: '5', id: '77' }, body: {} };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, undefined); // res.json() implicito -> 200
    assert.strictEqual(seenParams[seenParams.length - 2], '77');
    assert.strictEqual(seenParams[seenParams.length - 1], '5');
});

await testAsync('DELETE filtra por id Y guardia_id (no borra recursos de otra guardia)', async () => {
    const handler = findHandler(guardiasRouter, 'delete', '/:guardiaId/' + sub + '/:id');
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return {}; };
    const req = { params: { guardiaId: '5', id: '77' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 204);
    assert.deepStrictEqual(seenParams, ['77', '5']);
});

}

console.log('\n== saneado de campos (V.str/V.num/V.bool) ==');

await testAsync('POST situacion: comentarios se trunca a L.comentarios (5000), no se inserta sin limite', async () => {
    const handler = findHandler(guardiasRouter, 'post', '/:guardiaId/situacion');
    let seenParams = null;
    const comentariosLargos = 'x'.repeat(6000);
    pool.query = async (sql, params) => { seenParams = params; return { rows: [{ id: 1, guardia_id: 5 }] }; };
    const req = { params: { guardiaId: '5' }, body: { comentarios: comentariosLargos, euros: 100 } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res._status, 201);
    assert.strictEqual(seenParams[1].length, 5000, 'comentarios debe truncarse a L.comentarios');
});

await testAsync('POST situacion: euros por encima del maximo se recorta a 1e7', async () => {
    const handler = findHandler(guardiasRouter, 'post', '/:guardiaId/situacion');
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return { rows: [{ id: 1, guardia_id: 5 }] }; };
    const req = { params: { guardiaId: '5' }, body: { euros: 999999999 } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(seenParams[3], 1e7, 'euros no debe superar el maximo configurado');
});

await testAsync('POST situacion: acepta n_talon en snake_case cuando no llega nTalon', async () => {
    const handler = findHandler(guardiasRouter, 'post', '/:guardiaId/situacion');
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return { rows: [{ id: 1, guardia_id: 5 }] }; };
    const req = { params: { guardiaId: '5' }, body: { n_talon: 'T-123' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(seenParams[2], 'T-123', 'debe aceptar el fallback snake_case n_talon');
});

await testAsync('POST apelaciones: acepta n_expediente en snake_case cuando no llega nExpediente', async () => {
    const handler = findHandler(guardiasRouter, 'post', '/:guardiaId/apelaciones');
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return { rows: [{ id: 1, guardia_id: 5 }] }; };
    const req = { params: { guardiaId: '5' }, body: { n_expediente: 'Exp-99' } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(seenParams[1], 'Exp-99', 'debe aceptar el fallback snake_case n_expediente');
});

console.log('\n' + (fail === 0 ? 'TODOS OK' : 'HAY FALLOS') + ' — pass: ' + pass + ', fail: ' + fail);
process.exit(fail === 0 ? 0 : 1);

}

run();
