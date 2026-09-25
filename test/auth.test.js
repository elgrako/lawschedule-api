/**
 * Tests de rutas (auth.js: /register, /login). Ejecutar: node test/auth.test.js
 * Sin cobertura previa (security.test.js solo prueba el middleware auth.js de
 * verificacion de JWT, no los handlers de registro/login en si).
 */
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.NODE_ENV = 'test';

const assert = require('assert');
const bcrypt = require('bcrypt');

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
const authRouter = require('../src/routes/auth.js');

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
        json(b) { this._body = b; return this; }
    };
}

async function run() {

console.log('\n== routes: auth.js /register ==');
const register = findHandler(authRouter, 'post', '/register');

await testAsync('sin email/nombre -> 400, sin llegar a la BD', async () => {
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { body: { password: 'Abcdefg123!' } };
    const res = fakeRes();
    await register(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0);
});

await testAsync('email invalido -> 400', async () => {
    const req = { body: { email: 'no-es-un-email', nombre: 'Ana', password: 'Abcdefg123!' } };
    const res = fakeRes();
    await register(req, res);
    assert.strictEqual(res._status, 400);
});

await testAsync('password corta -> 400', async () => {
    const req = { body: { email: 'a@a.com', nombre: 'Ana', password: 'Ab1!' } };
    const res = fakeRes();
    await register(req, res);
    assert.strictEqual(res._status, 400);
});

await testAsync('password sin variedad de clases -> 400', async () => {
    const req = { body: { email: 'a@a.com', nombre: 'Ana', password: 'aaaaaaaaaa' } };
    const res = fakeRes();
    await register(req, res);
    assert.strictEqual(res._status, 400);
});

await testAsync('email ya registrado (23505) -> 409, no expone detalle interno', async () => {
    pool.query = async () => { const e = new Error('duplicate'); e.code = '23505'; throw e; };
    const req = { body: { email: 'a@a.com', nombre: 'Ana', password: 'Abcdefg123!' } };
    const res = fakeRes();
    await register(req, res);
    assert.strictEqual(res._status, 409);
});

await testAsync('registro valido -> 201 con token, password_hash NUNCA sale en la respuesta', async () => {
    pool.query = async () => ({ rows: [{ id: 1, email: 'a@a.com', nombre: 'Ana',
        password_hash: 'secreto-hash-nunca-debe-salir', created_at: 1000 }] });
    const req = { body: { email: 'A@A.com  ', nombre: '  Ana  ', password: 'Abcdefg123!' } };
    const res = fakeRes();
    await register(req, res);
    assert.strictEqual(res._status, 201);
    assert.strictEqual(res._body.usuario.email, 'a@a.com', 'email normalizado a minusculas/trim');
    assert.strictEqual(res._body.usuario.password_hash, undefined, 'password_hash jamas debe viajar al cliente');
    assert.ok(typeof res._body.token === 'string' && res._body.token.length > 0);
});

await testAsync('pool.query lanza error generico -> 500, sin filtrar el mensaje del driver', async () => {
    pool.query = async () => { throw new Error('detalle interno sensible de postgres'); };
    const req = { body: { email: 'a@a.com', nombre: 'Ana', password: 'Abcdefg123!' } };
    const res = fakeRes();
    await register(req, res);
    assert.strictEqual(res._status, 500);
    assert.ok(JSON.stringify(res._body).indexOf('sensible') === -1, 'no debe filtrar el mensaje interno');
});

console.log('\n== routes: auth.js /login ==');
const login = findHandler(authRouter, 'post', '/login');

await testAsync('sin email o password -> 401 (no 400: no revela que campo falta)', async () => {
    const req = { body: { email: 'a@a.com' } };
    const res = fakeRes();
    await login(req, res);
    assert.strictEqual(res._status, 401);
});

await testAsync('usuario inexistente -> 401 generico (anti user-enumeration)', async () => {
    pool.query = async () => ({ rows: [] });
    const req = { body: { email: 'noexiste_' + Date.now() + '@a.com', password: 'cualquierpass' } };
    const res = fakeRes();
    await login(req, res);
    assert.strictEqual(res._status, 401);
    assert.strictEqual(res._body.error, 'Credenciales incorrectas');
});

await testAsync('password incorrecta -> 401, mismo mensaje generico', async () => {
    const hash = await bcrypt.hash('LaPasswordReal123!', 12);
    pool.query = async () => ({ rows: [{ id: 1, email: 'b@a.com', nombre: 'B', password_hash: hash, created_at: 1000 }] });
    const req = { body: { email: 'login_fail_' + Date.now() + '@a.com', password: 'Incorrecta123!' } };
    const res = fakeRes();
    await login(req, res);
    assert.strictEqual(res._status, 401);
    assert.strictEqual(res._body.error, 'Credenciales incorrectas');
});

await testAsync('login valido -> 200 con token, password_hash nunca sale', async () => {
    const hash = await bcrypt.hash('LaPasswordReal123!', 12);
    pool.query = async () => ({ rows: [{ id: 1, email: 'ok_' + Date.now() + '@a.com', nombre: 'B', password_hash: hash, created_at: 1000 }] });
    const req = { body: { email: 'ok@a.com', password: 'LaPasswordReal123!' } };
    const res = fakeRes();
    await login(req, res);
    assert.strictEqual(res._body.usuario.password_hash, undefined);
    assert.ok(typeof res._body.token === 'string' && res._body.token.length > 0);
    assert.strictEqual(res._status, undefined); // res.json() implicito -> 200
});

await testAsync('bloqueo por intentos fallidos repetidos -> 429 tras superar el umbral', async () => {
    const email = 'lockout_' + Date.now() + '@a.com';
    pool.query = async () => ({ rows: [] }); // usuario inexistente: cada intento cuenta como fallo
    let last;
    for (let i = 0; i < 9; i++) {
        const req = { body: { email, password: 'x' } };
        const res = fakeRes();
        await login(req, res);
        last = res;
    }
    assert.strictEqual(last._status, 429, 'tras 9 intentos (umbral=8) debe bloquear la cuenta');
});

await testAsync('password mas larga que el maximo -> 401 sin llegar a bcrypt (anti DoS)', async () => {
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { body: { email: 'x@a.com', password: 'a'.repeat(500) } };
    const res = fakeRes();
    await login(req, res);
    assert.strictEqual(res._status, 401);
    assert.strictEqual(calls, 0, 'no debe consultar la BD con una password que ya excede el maximo');
});

console.log('\n== routes: auth.js /change-password ==');
const changePassword = findHandler(authRouter, 'post', '/change-password');

await testAsync('sin currentPassword -> 400, sin llegar a la BD', async () => {
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { userId: 1, body: { newPassword: 'NuevaPass123!' } };
    const res = fakeRes();
    await changePassword(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0);
});

await testAsync('newPassword invalida (corta) -> 400, sin llegar a la BD', async () => {
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { userId: 1, body: { currentPassword: 'ActualPass123!', newPassword: 'Ab1!' } };
    const res = fakeRes();
    await changePassword(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0);
});

await testAsync('currentPassword mas larga que el maximo -> 401 sin llegar a bcrypt (anti DoS)', async () => {
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { userId: 1, body: { currentPassword: 'a'.repeat(500), newPassword: 'NuevaPass123!' } };
    const res = fakeRes();
    await changePassword(req, res);
    assert.strictEqual(res._status, 401);
    assert.strictEqual(calls, 0);
});

await testAsync('usuario no encontrado -> 401 generico', async () => {
    pool.query = async () => ({ rows: [] });
    const req = { userId: 999, body: { currentPassword: 'ActualPass123!', newPassword: 'NuevaPass123!' } };
    const res = fakeRes();
    await changePassword(req, res);
    assert.strictEqual(res._status, 401);
    assert.strictEqual(res._body.error, 'Contrasena actual incorrecta');
});

await testAsync('currentPassword incorrecta -> 401, no actualiza la BD', async () => {
    const hash = await bcrypt.hash('LaPasswordReal123!', 12);
    let updateCalled = false;
    pool.query = async (sql) => {
        if (/UPDATE/.test(sql)) updateCalled = true;
        return { rows: [{ password_hash: hash }] };
    };
    const req = { userId: 1, body: { currentPassword: 'Incorrecta123!', newPassword: 'NuevaPass123!' } };
    const res = fakeRes();
    await changePassword(req, res);
    assert.strictEqual(res._status, 401);
    assert.strictEqual(updateCalled, false, 'no debe tocar la BD si la contrasena actual no coincide');
});

await testAsync('bloqueo por intentos fallidos repetidos en change-password -> 429 tras superar el umbral', async () => {
    // userId unico para no compartir contador con otras ejecuciones de este test.
    const userId = Date.now();
    const hash = await bcrypt.hash('LaPasswordReal123!', 12);
    pool.query = async () => ({ rows: [{ password_hash: hash }] }); // currentPassword nunca coincide con "x"
    let last;
    for (let i = 0; i < 9; i++) {
        const req = { userId, body: { currentPassword: 'x', newPassword: 'NuevaPass123!' } };
        const res = fakeRes();
        await changePassword(req, res);
        last = res;
    }
    assert.strictEqual(last._status, 429, 'tras 9 intentos (umbral=8) debe bloquear la cuenta');
});

await testAsync('bloqueo de change-password no comparte contador con el de login', async () => {
    // Mismo userId ya bloqueado arriba en /change-password: /login (keyed por
    // email, no por id) para un usuario nuevo no debe verse afectado.
    const hash = await bcrypt.hash('LaPasswordReal123!', 12);
    pool.query = async () => ({ rows: [{ id: 555, email: 'sin_relacion_' + Date.now() + '@a.com', nombre: 'X', password_hash: hash, created_at: 1000 }] });
    const req = { body: { email: 'sin_relacion_' + Date.now() + '@a.com', password: 'LaPasswordReal123!' } };
    const res = fakeRes();
    await login(req, res);
    assert.notStrictEqual(res._status, 429, 'el bloqueo de change-password no debe filtrarse a login');
});

await testAsync('cambio valido -> 200 { ok: true }, actualiza password_hash del req.userId', async () => {
    const hash = await bcrypt.hash('LaPasswordReal123!', 12);
    let updateArgs = null;
    pool.query = async (sql, params) => {
        if (/UPDATE/.test(sql)) { updateArgs = params; return { rows: [{ token_version: 9 }] }; }
        return { rows: [{ password_hash: hash }] };
    };
    const req = { userId: 42, body: { currentPassword: 'LaPasswordReal123!', newPassword: 'OtraPassNueva456!' } };
    const res = fakeRes();
    await changePassword(req, res);
    assert.strictEqual(res._body.ok, true);
    assert.strictEqual(res._status, undefined); // res.json() implicito -> 200
    assert.strictEqual(updateArgs[1], 42, 'debe actualizar el password_hash del req.userId, no de otro id');
    assert.notStrictEqual(updateArgs[0], hash, 'debe guardar un hash nuevo, no reusar el antiguo');
});

await testAsync('cambio valido -> reemite token con el token_version incrementado (revoca los anteriores)', async () => {
    const jwt = require('jsonwebtoken');
    const hash = await bcrypt.hash('LaPasswordReal123!', 12);
    pool.query = async (sql) => {
        if (/UPDATE/.test(sql)) return { rows: [{ token_version: 9 }] };
        return { rows: [{ password_hash: hash }] };
    };
    const req = { userId: 42, body: { currentPassword: 'LaPasswordReal123!', newPassword: 'OtraPassNueva456!' } };
    const res = fakeRes();
    await changePassword(req, res);
    assert.strictEqual(typeof res._body.token, 'string', 'debe devolver un token nuevo tras cambiar la contrasena');
    const decoded = jwt.decode(res._body.token);
    assert.strictEqual(decoded.tokenVersion, 9, 'el nuevo token debe llevar el token_version ya incrementado');
    assert.strictEqual(decoded.sub, '42');
});

await testAsync('newPassword de exactamente MIN_PASSWORD (10) con 3 clases -> 200', async () => {
    const hash = await bcrypt.hash('ActualPass123!', 12);
    pool.query = async (sql) => {
        if (/UPDATE/.test(sql)) return { rows: [{ token_version: 1 }] };
        return { rows: [{ password_hash: hash }] };
    };
    const req = { userId: 1, body: { currentPassword: 'ActualPass123!', newPassword: 'Abcdefgh12' } };
    const res = fakeRes();
    await changePassword(req, res);
    assert.strictEqual(req.body.newPassword.length, 10);
    assert.strictEqual(res._body.ok, true);
});

await testAsync('newPassword de 9 caracteres (justo bajo el minimo) -> 400', async () => {
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { userId: 1, body: { currentPassword: 'ActualPass123!', newPassword: 'Abcdefgh1' } };
    assert.strictEqual(req.body.newPassword.length, 9);
    const res = fakeRes();
    await changePassword(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0, 'no debe consultar la BD si la nueva password ya es invalida por longitud');
});

await testAsync('newPassword de exactamente MAX_PASSWORD (200) con 3 clases -> 200', async () => {
    const hash = await bcrypt.hash('ActualPass123!', 12);
    pool.query = async (sql) => {
        if (/UPDATE/.test(sql)) return { rows: [{ token_version: 1 }] };
        return { rows: [{ password_hash: hash }] };
    };
    const newPassword = 'Ab1' + 'x'.repeat(197); // 200 chars, 3 clases (mayus+minus+digito)
    assert.strictEqual(newPassword.length, 200);
    const req = { userId: 1, body: { currentPassword: 'ActualPass123!', newPassword } };
    const res = fakeRes();
    await changePassword(req, res);
    assert.strictEqual(res._body.ok, true);
});

await testAsync('newPassword de 201 caracteres (justo sobre el maximo) -> 400', async () => {
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const newPassword = 'Ab1' + 'x'.repeat(198); // 201 chars
    assert.strictEqual(newPassword.length, 201);
    const req = { userId: 1, body: { currentPassword: 'ActualPass123!', newPassword } };
    const res = fakeRes();
    await changePassword(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0);
});

await testAsync('newPassword con exactamente 2 de 4 clases -> 400 (minusculas+digitos, sin mayus ni simbolo)', async () => {
    let calls = 0;
    pool.query = async () => { calls++; return { rows: [] }; };
    const req = { userId: 1, body: { currentPassword: 'ActualPass123!', newPassword: 'abcdefgh12' } };
    const res = fakeRes();
    await changePassword(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(calls, 0, 'con solo 2 clases no debe llegar a la BD');
});

await testAsync('newPassword con exactamente 3 de 4 clases (mayus+minus+digito, sin simbolo) -> 200', async () => {
    const hash = await bcrypt.hash('ActualPass123!', 12);
    pool.query = async (sql) => {
        if (/UPDATE/.test(sql)) return { rows: [{ token_version: 1 }] };
        return { rows: [{ password_hash: hash }] };
    };
    const req = { userId: 1, body: { currentPassword: 'ActualPass123!', newPassword: 'Abcdefgh12' } };
    const res = fakeRes();
    await changePassword(req, res);
    assert.strictEqual(res._body.ok, true);
});

console.log('\n== routes: auth.js /logout ==');
const logout = findHandler(authRouter, 'post', '/logout');

await testAsync('logout valido -> 200 {ok:true}, incrementa token_version del req.userId', async () => {
    let seenParams = null;
    pool.query = async (sql, params) => { seenParams = params; return { rows: [] }; };
    const req = { userId: 7 };
    const res = fakeRes();
    await logout(req, res);
    assert.strictEqual(res._body.ok, true);
    assert.deepStrictEqual(seenParams, [7]);
});

await testAsync('logout con pool.query lanzando -> 500', async () => {
    pool.query = async () => { throw new Error('boom'); };
    const req = { userId: 7 };
    const res = fakeRes();
    await logout(req, res);
    assert.strictEqual(res._status, 500);
});

test('/auth/logout esta protegida por el middleware auth (JWT), no solo por el handler', () => {
    const layer = authRouter.stack.find(l =>
        l.route && l.route.path === '/logout' && l.route.methods.post
    );
    assert.ok(layer, 'no se encontro la ruta POST /logout');
    assert.strictEqual(layer.route.stack.length, 2,
        'la ruta debe tener 2 handlers en la pila: auth + el handler real');
    const authMiddleware = require('../src/middleware/auth');
    assert.strictEqual(layer.route.stack[0].handle, authMiddleware,
        'logout debe pasar por el middleware auth ANTES del handler (si no, cualquiera podria bumpear el token_version de otro usuario)');
});

test('/auth/change-password esta protegida por el middleware auth (JWT), no solo por el handler', () => {
    // Los tests de arriba invocan el handler directamente con findHandler(), lo que
    // SALTA el middleware auth de la ruta. Si algun dia se quitara `auth` de
    // `router.post('/change-password', auth, handler)`, ese fallo no se notaria
    // en ninguno de los tests anteriores: se verifica aqui, a nivel de cableado.
    const layer = authRouter.stack.find(l =>
        l.route && l.route.path === '/change-password' && l.route.methods.post
    );
    assert.ok(layer, 'no se encontro la ruta POST /change-password');
    assert.strictEqual(layer.route.stack.length, 2,
        'la ruta debe tener 2 handlers en la pila: auth + el handler real');
    const authMiddleware = require('../src/middleware/auth');
    assert.strictEqual(layer.route.stack[0].handle, authMiddleware,
        'change-password debe pasar por el middleware auth ANTES del handler');
});

console.log('\n' + (fail === 0 ? 'TODOS OK' : 'HAY FALLOS') + ' — pass: ' + pass + ', fail: ' + fail);
process.exit(fail === 0 ? 0 : 1);

}

run();
