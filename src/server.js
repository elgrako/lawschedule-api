require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const app  = require('./app');
const pool = require('./db/pool');

const PORT = process.env.PORT || 3000;

async function start() {
    await pool.query('SELECT 1');
    console.log('DB conectada');

    const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('Migraciones OK');

    app.listen(PORT, () => console.log('API en puerto ' + PORT));
}

start().catch(err => {
    console.error('Error al arrancar:', err.message);
    process.exit(1);
});
