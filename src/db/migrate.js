require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const pool = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id         SERIAL PRIMARY KEY,
            name       VARCHAR(255) UNIQUE NOT NULL,
            applied_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
        )
    `);
}

async function appliedNames() {
    const { rows } = await pool.query('SELECT name FROM schema_migrations');
    return new Set(rows.map(r => r.name));
}

// Aplica las migraciones de src/db/migrations/*.sql que aun no esten
// registradas en schema_migrations, en orden alfabetico (por eso el prefijo
// numerico de 3 digitos), cada una en su propia transaccion. A diferencia
// del schema.sql monolitico anterior (re-aplicado entero e idempotente en
// cada boot), cada migracion corre una unica vez y queda registrada: los
// cambios no aditivos (renombrar/borrar columnas, backfills de datos) ya no
// necesitan guardas idempotentes escritas a mano.
async function runMigrations() {
    await ensureMigrationsTable();
    const applied = await appliedNames();
    const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();

    let ranCount = 0;
    for (const file of files) {
        if (applied.has(file)) continue;
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
            await client.query('COMMIT');
            ranCount++;
            console.log('[migrate] aplicada: ' + file);
        } catch (err) {
            await client.query('ROLLBACK');
            throw new Error('Fallo la migracion ' + file + ': ' + err.message);
        } finally {
            client.release();
        }
    }
    return ranCount;
}

module.exports = { runMigrations };

if (require.main === module) {
    runMigrations()
        .then(n => { console.log('Migraciones OK (' + n + ' nuevas)'); return pool.end(); })
        .catch(err => { console.error(err); process.exit(1); });
}
