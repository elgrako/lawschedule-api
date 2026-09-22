require('dotenv').config();
require('./config').validate();
const app  = require('./app');
const pool = require('./db/pool');
const { runMigrations } = require('./db/migrate');

const PORT = process.env.PORT || 3000;

async function start() {
    await pool.query('SELECT 1');
    console.log('DB conectada');

    const n = await runMigrations();
    console.log('Migraciones OK (' + n + ' nuevas)');

    app.listen(PORT, () => console.log('API en puerto ' + PORT));
}

start().catch(err => {
    console.error('Error al arrancar:', err.message);
    process.exit(1);
});
