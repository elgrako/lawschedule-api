/**
 * Tests de ownership.js (control de acceso a nivel de objeto / IDOR-BOLA).
 * Ejecutar: node test/ownership.test.js
 *
 * Esta es la proteccion mas critica del backend: sin ella, un usuario autenticado
 * podria leer/modificar registros o guardias de OTRO usuario cambiando el id en la URL.
 * Estos tests invocan `ownsRegistro`/`ownsGuardia` directamente (mockeando pool.query)
 * y ademas verifican que el "cableado" (router.param en guardias.js, el middleware
 * montado en app.js para documentos) sigue en su sitio: una regresion que borre esa
 * linea reintroduciria el IDOR de forma silenciosa sin estos tests.
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
const { ownsRegistro, ownsGuardia, isPositiveInt } = require('../src/middleware/ownership');

function fakeRes() {
    return {
        status(c) { this._status = c; return this; },
        json(b) { this._body = b; return this; }
    };
}

async function run() {

console.log('\n== ownsRegistro (IDOR) ==');

await testAsync('id no numerico -> 400, sin tocar la BD', async () => {
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { params: { registroId: '5 OR 1=1' }, userId: 7 };
    const res = fakeRes();
    let nexted = false;
    await ownsRegistro(req, res, () => { nexted = true; });
    assert.strictEqual(res._status, 400);
    assert.strictEqual(nexted, false);
    assert.strictEqual(calls, 0, 'no deberia consultar la BD con un id invalido');
});

await testAsync('registro de OTRO usuario -> 404, next NO se llama (no se filtra si existe)', async () => {
    pool.query = async () => ({ rows: [] }); // el registro existe pero no es de este usuario
    const req = { params: { registroId: '10' }, userId: 7 };
    const res = fakeRes();
    let nexted = false;
    await ownsRegistro(req, res, () => { nexted = true; });
    assert.strictEqual(res._status, 404);
    assert.strictEqual(nexted, false, 'el usuario 7 NUNCA debe pasar de largo con un registro ajeno');
});

await testAsync('registro propio -> next() sin responder', async () => {
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return { rows: [{ '?column?': 1 }] }; };
    const req = { params: { registroId: '10' }, userId: 7 };
    const res = fakeRes();
    let nexted = false;
    await ownsRegistro(req, res, () => { nexted = true; });
    assert.strictEqual(nexted, true);
    assert.strictEqual(res._status, undefined, 'no debe haber respondido si es dueño');
    assert.deepStrictEqual(seenParams, [10, 7], 'debe filtrar por id Y usuario_id=req.userId');
});

await testAsync('pool.query lanza -> 500, next no se llama', async () => {
    pool.query = async () => { throw new Error('conexion perdida'); };
    const req = { params: { registroId: '10' }, userId: 7 };
    const res = fakeRes();
    let nexted = false;
    await ownsRegistro(req, res, () => { nexted = true; });
    assert.strictEqual(res._status, 500);
    assert.strictEqual(nexted, false);
});

console.log('\n== ownsGuardia (IDOR) ==');

await testAsync('guardia de OTRO usuario -> 404, next NO se llama', async () => {
    pool.query = async () => ({ rows: [] });
    const req = { params: { guardiaId: '99' }, userId: 7 };
    const res = fakeRes();
    let nexted = false;
    await ownsGuardia(req, res, () => { nexted = true; });
    assert.strictEqual(res._status, 404);
    assert.strictEqual(nexted, false);
});

await testAsync('guardia propia -> next()', async () => {
    pool.query = async () => ({ rows: [{ '?column?': 1 }] });
    const req = { params: { guardiaId: '3' }, userId: 7 };
    const res = fakeRes();
    let nexted = false;
    await ownsGuardia(req, res, () => { nexted = true; });
    assert.strictEqual(nexted, true);
});

test('isPositiveInt rechaza payloads con forma de inyeccion SQL', () => {
    assert.strictEqual(isPositiveInt('1 OR 1=1'), false);
    assert.strictEqual(isPositiveInt("1; DROP TABLE registros"), false);
});

console.log('\n== Cableado (regresion): las rutas anidadas SIGUEN pasando por ownership ==');

test('guardias.js registra ownsGuardia como router.param("guardiaId")', () => {
    // Los tests de rutas invocan los handlers directamente con findHandler(), lo que
    // SALTA router.param(). Si algun dia se borra esta linea de guardias.js, ese fallo
    // no se notaria en routes.test.js: por eso se verifica aqui, a nivel de cableado.
    delete require.cache[require.resolve('../src/routes/guardias.js')];
    const guardiasRouter = require('../src/routes/guardias.js');
    assert.ok(Array.isArray(guardiasRouter.params && guardiasRouter.params.guardiaId),
        'guardias.js debe registrar router.param("guardiaId", ...)');
    assert.strictEqual(guardiasRouter.params.guardiaId.length, 1);
});

test('app.js monta ownsRegistro ANTES del router de documentos', () => {
    // Verifica que /v1/registros/:registroId/documentos sigue protegido por ownsRegistro.
    // Si se quitara ese middleware del app.use(...), cualquier usuario podria leer/borrar
    // documentos de expedientes ajenos con solo cambiar registroId en la URL.
    process.env.JWT_SECRET  = process.env.JWT_SECRET  || 'x'.repeat(48);
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x';
    process.env.NODE_ENV = 'test';
    const app = require('../src/app.js');
    const layer = app._router.stack.find(l =>
        l.name === 'router' && l.regexp && l.regexp.test('/v1/registros/1/documentos')
    );
    assert.ok(layer, 'no se encontro el layer de documentos en app._router.stack');
    // El handle de este layer ES el router de documentos.js; ownsRegistro debe estar
    // en la pila de handlers montada ANTES de el en app.js (mismo app.use call).
    // Comprobamos indirectamente: el router de documentos no debe tener rutas propias
    // que dupliquen la comprobacion, así que exigimos que exista un layer previo cuyo
    // handle sea la funcion ownsRegistro exportada por ownership.js.
    const { ownsRegistro } = require('../src/middleware/ownership');
    const hasOwnsRegistro = app._router.stack.some(l => l.handle === ownsRegistro);
    assert.ok(hasOwnsRegistro, 'ownsRegistro ya no esta montado en app.js (regresion IDOR)');
});

test('app.js monta /v1/clientes protegido por el middleware auth (JWT)', () => {
    // clientes.js filtra por req.userId dentro de cada handler, pero eso solo
    // protege si auth ya puso ese valor. Si algun dia se quitara `auth` del
    // app.use('/v1/clientes', ...), req.userId quedaria undefined y las
    // consultas fallarian de forma rara en vez de rechazar limpiamente con 401
    // — o peor, si alguna query no lo comprobara, expondria clientes de cualquiera.
    process.env.JWT_SECRET  = process.env.JWT_SECRET  || 'x'.repeat(48);
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x';
    const app = require('../src/app.js');
    const layer = app._router.stack.find(l =>
        l.name === 'router' && l.regexp && l.regexp.test('/v1/clientes/1')
    );
    assert.ok(layer, 'no se encontro el layer de clientes en app._router.stack');
    const authMiddleware = require('../src/middleware/auth');
    const hasAuth = app._router.stack.some(l => l.handle === authMiddleware);
    assert.ok(hasAuth, 'el middleware auth ya no esta montado en app.js para /v1/clientes');
});

console.log('\n' + (fail === 0 ? 'TODOS OK' : 'HAY FALLOS') + ' — pass: ' + pass + ', fail: ' + fail);
process.exit(fail === 0 ? 0 : 1);

}

run();
