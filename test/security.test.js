/**
 * Tests de seguridad. Ejecutar: node test/security.test.js
 * No requiere BD real: la seccion de auth middleware mockea pool.query
 * (mismo estilo que test/ownership.test.js), el resto es logica pura.
 */
const assert = require('assert');
const jwt    = require('jsonwebtoken');

process.env.JWT_SECRET = 'x'.repeat(48);
process.env.NODE_ENV   = 'test';

let pass = 0, fail = 0;
function test(name, fn) {
    try { fn(); console.log('  OK   ' + name); pass++; }
    catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); fail++; }
}
async function testAsync(name, fn) {
    try { await fn(); console.log('  OK   ' + name); pass++; }
    catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); fail++; }
}

async function main() {

console.log('\n== validate.js ==');
const V = require('../src/middleware/validate');

test('id rechaza inyeccion SQL en parametro', () => {
    assert.strictEqual(V.id("1 OR 1=1"), null);
    assert.strictEqual(V.id("1; DROP TABLE registros"), null);
    assert.strictEqual(V.id("../../etc/passwd"), null);
});
test('id rechaza negativos, cero y no enteros', () => {
    assert.strictEqual(V.id('-1'), null);
    assert.strictEqual(V.id('0'), null);
    assert.strictEqual(V.id('1.5'), null);
    assert.strictEqual(V.id(''), null);
});
test('id acepta enteros positivos', () => assert.strictEqual(V.id('42'), 42));

test('str elimina NUL y caracteres de control', () => {
    assert.strictEqual(V.str('a\u0000b\u001Fc', 50), 'abc');
});
test('str trunca al maximo', () => assert.strictEqual(V.str('x'.repeat(9999), 20).length, 20));
test('str rechaza no-strings (type confusion)', () => {
    assert.strictEqual(V.str({ $ne: null }, 50), null);
    assert.strictEqual(V.str(['a'], 50), null);
    assert.strictEqual(V.str(123, 50), null);
});
test('estado solo admite valores del enum', () => {
    assert.strictEqual(V.estado('DROP TABLE'), 'PENDIENTE');
    assert.strictEqual(V.estado('TERMINADO'), 'TERMINADO');
});
test('num acota y neutraliza NaN/negativos', () => {
    assert.strictEqual(V.num(1e12, { max: 1e7 }), 1e7);
    assert.strictEqual(V.num('abc'), 0);
    assert.strictEqual(V.num(-100), 0);
});
test('bool no acepta strings arbitrarias', () => {
    assert.strictEqual(V.bool('yes'), false);
    assert.strictEqual(V.bool('true'), true);
    assert.strictEqual(V.bool(true), true);
});

console.log('\n== auth middleware (JWT) ==');
const pool = require('../src/db/pool');
const auth = require('../src/middleware/auth');

// Por defecto el usuario 7 tiene token_version=0 en la "BD" mockeada: coincide
// con los tokens de este archivo, que no llevan tokenVersion (payload.tokenVersion || 0).
pool.query = async () => ({ rows: [{ token_version: 0 }] });

async function runAuth(header) {
    const req = { headers: header ? { authorization: header } : {} };
    let status = null, body = null, nexted = false;
    const res = {
        status(c) { status = c; return this; },
        json(b) { body = b; return this; }
    };
    await auth(req, res, () => { nexted = true; });
    return { req, status, body, nexted };
}

const validToken = jwt.sign({ sub: '7' }, process.env.JWT_SECRET, {
    algorithm: 'HS256', expiresIn: '1h', issuer: 'lawschedule-api', audience: 'lawschedule-app'
});

await testAsync('token valido pasa y fija userId numerico', async () => {
    const r = await runAuth('Bearer ' + validToken);
    assert.ok(r.nexted);
    assert.strictEqual(r.req.userId, 7);
});
await testAsync('sin cabecera -> 401', async () => assert.strictEqual((await runAuth(null)).status, 401));
await testAsync('esquema incorrecto -> 401', async () => assert.strictEqual((await runAuth('Basic abc')).status, 401));
await testAsync('token vacio -> 401', async () => assert.strictEqual((await runAuth('Bearer ')).status, 401));
await testAsync('firma invalida -> 401', async () => {
    const t = jwt.sign({ sub: '7' }, 'otro-secreto-distinto-pero-largo-1234', {
        issuer: 'lawschedule-api', audience: 'lawschedule-app' });
    assert.strictEqual((await runAuth('Bearer ' + t)).status, 401);
});
await testAsync('alg:none rechazado (confusion de algoritmo)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: '7', iss: 'lawschedule-api', aud: 'lawschedule-app' })).toString('base64url');
    assert.strictEqual((await runAuth('Bearer ' + header + '.' + payload + '.')).status, 401);
});
await testAsync('token expirado -> 401', async () => {
    const t = jwt.sign({ sub: '7' }, process.env.JWT_SECRET, {
        algorithm: 'HS256', expiresIn: '-10s', issuer: 'lawschedule-api', audience: 'lawschedule-app' });
    assert.strictEqual((await runAuth('Bearer ' + t)).status, 401);
});
await testAsync('issuer/audience incorrectos -> 401', async () => {
    const t = jwt.sign({ sub: '7' }, process.env.JWT_SECRET, {
        algorithm: 'HS256', expiresIn: '1h', issuer: 'otra-api', audience: 'otra-app' });
    assert.strictEqual((await runAuth('Bearer ' + t)).status, 401);
});
await testAsync('sub no numerico rechazado', async () => {
    const t = jwt.sign({ sub: 'admin' }, process.env.JWT_SECRET, {
        algorithm: 'HS256', expiresIn: '1h', issuer: 'lawschedule-api', audience: 'lawschedule-app' });
    assert.strictEqual((await runAuth('Bearer ' + t)).status, 401);
});

console.log('\n== revocacion de JWT (token_version) ==');
await testAsync('token con tokenVersion desactualizado -> 401 (revocado por cambio de contrasena)', async () => {
    pool.query = async () => ({ rows: [{ token_version: 3 }] }); // la BD ya avanzo (p.ej. tras change-password)
    const t = jwt.sign({ sub: '7', tokenVersion: 2 }, process.env.JWT_SECRET, {
        algorithm: 'HS256', expiresIn: '1h', issuer: 'lawschedule-api', audience: 'lawschedule-app' });
    const r = await runAuth('Bearer ' + t);
    assert.strictEqual(r.status, 401);
    assert.strictEqual(r.nexted, false);
});
await testAsync('token con tokenVersion vigente -> pasa', async () => {
    pool.query = async () => ({ rows: [{ token_version: 3 }] });
    const t = jwt.sign({ sub: '7', tokenVersion: 3 }, process.env.JWT_SECRET, {
        algorithm: 'HS256', expiresIn: '1h', issuer: 'lawschedule-api', audience: 'lawschedule-app' });
    const r = await runAuth('Bearer ' + t);
    assert.ok(r.nexted);
    assert.strictEqual(r.req.userId, 7);
});
await testAsync('usuario ya no existe en BD -> 401 (no 500)', async () => {
    pool.query = async () => ({ rows: [] });
    const r = await runAuth('Bearer ' + validToken);
    assert.strictEqual(r.status, 401);
    assert.strictEqual(r.nexted, false);
});

pool.query = async () => ({ rows: [{ token_version: 0 }] }); // restaurar para el resto del archivo

console.log('\n== ownership (IDOR / BOLA) ==');
const { isPositiveInt } = require('../src/middleware/ids');
test('isPositiveInt bloquea payloads no numericos', () => {
    assert.strictEqual(isPositiveInt('5'), true);
    assert.strictEqual(isPositiveInt('5 OR 1=1'), false);
    assert.strictEqual(isPositiveInt('abc'), false);
    assert.strictEqual(isPositiveInt('-1'), false);
});

console.log('\n== config fail-fast ==');
test('rechaza secreto corto o de ejemplo', () => {
    const { execFileSync } = require('child_process');
    function arranca(secret) {
        try {
            execFileSync(process.execPath,
                ['-e', "process.env.JWT_SECRET=" + JSON.stringify(secret) +
                       ";process.env.DATABASE_URL='postgres://x';require('./src/config').validate()"],
                { cwd: __dirname + '/..', stdio: 'pipe' });
            return true;
        } catch { return false; }
    }
    assert.strictEqual(arranca('corto'), false, 'secreto corto deberia fallar');
    assert.strictEqual(arranca('cambia_esto_por_un_secreto_largo_y_aleatorio'), false, 'valor de ejemplo deberia fallar');
    assert.strictEqual(arranca('a'.repeat(48)), true, 'secreto valido deberia arrancar');
});

console.log('\n' + (fail === 0 ? 'TODOS OK' : 'HAY FALLOS') + ' — pass: ' + pass + ', fail: ' + fail);
process.exit(fail === 0 ? 0 : 1);

}

main();
