/**
 * Validacion fail-fast de configuracion critica.
 * Arrancar en produccion con secretos debiles o ausentes es un fallo de seguridad,
 * no un aviso: el proceso termina.
 */
const PROD = process.env.NODE_ENV === 'production';

function fail(msg) {
    console.error('[config] ' + msg);
    process.exit(1);
}

function validate() {
    const secret = process.env.JWT_SECRET;
    if (!secret) fail('JWT_SECRET no definido.');
    if (secret.length < 32) fail('JWT_SECRET demasiado corto (minimo 32 caracteres).');
    if (/^(cambia|change|secret|test|dev)/i.test(secret)) {
        fail('JWT_SECRET parece un valor de ejemplo. Genera uno aleatorio.');
    }
    if (!process.env.DATABASE_URL) fail('DATABASE_URL no definido.');
    if (PROD && !process.env.DB_CA_CERT && process.env.DB_SSL_INSECURE !== 'true') {
        console.warn('[config] AVISO: sin DB_CA_CERT. Se verificara TLS con las CA del sistema. ' +
                     'Si tu proveedor usa cert autofirmado, aporta DB_CA_CERT.');
    }
}

module.exports = { validate, PROD };
