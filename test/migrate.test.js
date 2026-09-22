/**
 * Tests de src/db/migrate.js (runner de migraciones). Ejecutar:
 * node test/migrate.test.js
 *
 * Mockea pool.query/pool.connect (mismo estilo que el resto de tests) y
 * fs.readdirSync/readFileSync para controlar que archivos de migracion "ven".
 * No toca una BD real ni el disco de verdad.
 */
const assert = require('assert');
const fs = require('fs');

let pass = 0, fail = 0;
async function testAsync(name, fn) {
    try { await fn(); console.log('  OK   ' + name); pass++; }
    catch (e) { console.log('  FAIL ' + name + ' -> ' + e.message); fail++; }
}

const pool = require('../src/db/pool');
const { runMigrations } = require('../src/db/migrate');

function fakeClient(queryImpl) {
    return {
        queries: [],
        query(sql, params) {
            this.queries.push(sql);
            return (queryImpl || (async () => ({ rows: [] })))(sql, params);
        },
        released: false,
        release() { this.released = true; }
    };
}

async function run() {

console.log('\n== migrate.js: runMigrations ==');

await testAsync('sin migraciones pendientes -> no conecta ningun client, devuelve 0', async () => {
    pool.query = async (sql) => {
        if (/CREATE TABLE/.test(sql)) return { rows: [] };
        if (/SELECT name/.test(sql)) return { rows: [{ name: '001_baseline.sql' }] };
        return { rows: [] };
    };
    let connectCalls = 0;
    pool.connect = async () => { connectCalls++; return fakeClient(); };
    fs.readdirSync = () => ['001_baseline.sql'];
    fs.readFileSync = () => 'SELECT 1;';

    const n = await runMigrations();

    assert.strictEqual(n, 0);
    assert.strictEqual(connectCalls, 0, 'no debe abrir transaccion si no hay nada pendiente');
});

await testAsync('una migracion pendiente -> BEGIN, sql, INSERT, COMMIT, en ese orden, y release', async () => {
    pool.query = async (sql) => {
        if (/CREATE TABLE/.test(sql)) return { rows: [] };
        if (/SELECT name/.test(sql)) return { rows: [] }; // nada aplicado aun
        return { rows: [] };
    };
    let client;
    pool.connect = async () => { client = fakeClient(); return client; };
    fs.readdirSync = () => ['001_baseline.sql'];
    fs.readFileSync = () => 'CREATE TABLE foo (id INT);';

    const n = await runMigrations();

    assert.strictEqual(n, 1);
    assert.deepStrictEqual(client.queries, [
        'BEGIN',
        'CREATE TABLE foo (id INT);',
        'INSERT INTO schema_migrations (name) VALUES ($1)',
        'COMMIT'
    ]);
    assert.ok(client.released, 'debe liberar el client tras aplicar la migracion');
});

await testAsync('ignora archivos que no terminan en .sql', async () => {
    pool.query = async (sql) => {
        if (/SELECT name/.test(sql)) return { rows: [] };
        return { rows: [] };
    };
    let connectCalls = 0;
    pool.connect = async () => { connectCalls++; return fakeClient(); };
    fs.readdirSync = () => ['001_baseline.sql.bak', 'README.md', '.gitkeep'];
    fs.readFileSync = () => '';

    const n = await runMigrations();

    assert.strictEqual(n, 0);
    assert.strictEqual(connectCalls, 0);
});

await testAsync('aplica en orden alfabetico (numerico por el prefijo de 3 digitos)', async () => {
    pool.query = async (sql) => {
        if (/SELECT name/.test(sql)) return { rows: [] };
        return { rows: [] };
    };
    const clients = [];
    pool.connect = async () => { const c = fakeClient(); clients.push(c); return c; };
    // Orden deliberadamente invertido en el listado del disco.
    fs.readdirSync = () => ['003_c.sql', '001_a.sql', '002_b.sql'];
    fs.readFileSync = (p) => 'SELECT ' + '\'' + p + '\'' + ';';

    const n = await runMigrations();

    assert.strictEqual(n, 3);
    assert.strictEqual(clients.length, 3);
    assert.ok(clients[0].queries[1].includes('001_a.sql'));
    assert.ok(clients[1].queries[1].includes('002_b.sql'));
    assert.ok(clients[2].queries[1].includes('003_c.sql'));
});

await testAsync('migracion que falla -> ROLLBACK, release, y error propagado con el nombre del archivo', async () => {
    pool.query = async (sql) => {
        if (/SELECT name/.test(sql)) return { rows: [] };
        return { rows: [] };
    };
    let client;
    pool.connect = async () => {
        client = fakeClient(async (sql) => {
            if (sql === 'CREATE TABLE mal sintaxis') throw new Error('sintaxis invalida');
            return { rows: [] };
        });
        return client;
    };
    fs.readdirSync = () => ['001_baseline.sql'];
    fs.readFileSync = () => 'CREATE TABLE mal sintaxis';

    let thrown = null;
    try {
        await runMigrations();
    } catch (e) {
        thrown = e;
    }

    assert.ok(thrown, 'debe relanzar el error');
    assert.ok(thrown.message.includes('001_baseline.sql'), 'el error debe mencionar el archivo que fallo');
    assert.ok(client.queries.includes('ROLLBACK'));
    assert.ok(!client.queries.includes('COMMIT'));
    assert.ok(client.released, 'debe liberar el client incluso si la migracion falla');
});

await testAsync('ya todo aplicado tras la primera corrida -> segunda corrida no reaplica nada', async () => {
    const appliedSoFar = new Set();
    pool.query = async (sql, params) => {
        if (/CREATE TABLE/.test(sql)) return { rows: [] };
        if (/SELECT name/.test(sql)) return { rows: [...appliedSoFar].map(name => ({ name })) };
        return { rows: [] };
    };
    pool.connect = async () => fakeClient(async (sql, params) => {
        if (sql === 'INSERT INTO schema_migrations (name) VALUES ($1)') appliedSoFar.add(params[0]);
        return { rows: [] };
    });
    fs.readdirSync = () => ['001_baseline.sql'];
    fs.readFileSync = () => 'SELECT 1;';

    const first = await runMigrations();
    const second = await runMigrations();

    assert.strictEqual(first, 1);
    assert.strictEqual(second, 0);
});

console.log('\n' + (fail === 0 ? 'TODOS OK' : 'HAY FALLOS') + ' — pass: ' + pass + ', fail: ' + fail);
process.exit(fail === 0 ? 0 : 1);

}

run();
