const { Pool } = require('pg');

// rejectUnauthorized:false desactiva la validacion del certificado del servidor
// y permite MITM sobre la conexion a la BD. Se verifica el certificado salvo
// que se pida explicitamente lo contrario (DB_SSL_INSECURE=true).
function sslConfig() {
    if (process.env.NODE_ENV !== 'production') return false;
    if (process.env.DB_CA_CERT) {
        return { rejectUnauthorized: true, ca: process.env.DB_CA_CERT };
    }
    if (process.env.DB_SSL_INSECURE === 'true') {
        console.warn('[db] TLS SIN verificacion de certificado (DB_SSL_INSECURE=true).');
        return { rejectUnauthorized: false };
    }
    return { rejectUnauthorized: true };
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslConfig(),
    max: Number(process.env.DB_POOL_MAX) || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
    console.error('[db] error inesperado:', err.code || err.name);
});

module.exports = pool;
