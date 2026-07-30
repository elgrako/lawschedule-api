const pool = require('../db/pool');
const { isPositiveInt } = require('./ids');

/**
 * Control de acceso a nivel de objeto (OWASP API1: BOLA/IDOR).
 *
 * Las sub-rutas anidadas (/v1/registros/:registroId/documentos,
 * /v1/guardias/:guardiaId/situacion, etc.) reciben el id del recurso padre
 * por la URL. Sin esta comprobacion, cualquier usuario autenticado podria
 * leer o modificar expedientes y guardias de OTRO letrado simplemente
 * cambiando el id en la URL.
 */

function ownsParent(table, paramName) {
    return async function (req, res, next) {
        const id = req.params[paramName];
        if (!isPositiveInt(id)) {
            return res.status(400).json({ error: 'Identificador invalido' });
        }
        try {
            const { rows } = await pool.query(
                `SELECT 1 FROM ${table} WHERE id = $1 AND usuario_id = $2 LIMIT 1`,
                [id, req.userId]
            );
            if (!rows.length) {
                // 404 en vez de 403: no revelamos si el recurso existe (evita enumeracion).
                return res.status(404).json({ error: 'No encontrado' });
            }
            next();
        } catch (err) {
            console.error('ownership check error:', err.code || err.name);
            res.status(500).json({ error: 'Error interno' });
        }
    };
}

module.exports = {
    ownsRegistro: ownsParent('registros', 'registroId'),
    ownsGuardia:  ownsParent('guardias', 'guardiaId'),
    isPositiveInt
};
