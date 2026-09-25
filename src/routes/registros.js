const router = require('express').Router();
const pool   = require('../db/pool');
const V      = require('../middleware/validate');
const L      = V.LIMITS;

function mapRow(r) {
    return {
        id:           Number(r.id),
        nombre:       r.nombre,
        dni:          r.dni,
        nExpediente:  r.n_expediente,
        euros:        Number(r.euros),
        email:        r.email,
        telefono:     r.telefono,
        presentado:   r.presentado,
        validado:     r.validado,
        pagado:       r.pagado,
        nTalon:       r.n_talon,
        comentarios:  r.comentarios,
        estado:       r.estado,
        clienteId:    r.cliente_id !== null ? Number(r.cliente_id) : null,
        usuario_id:   Number(r.usuario_id)
    };
}

/**
 * Resuelve un clienteId opcional del body a un id válido y PROPIO del usuario,
 * o null. Nunca confía en el clienteId a ciegas (anti-IDOR: enlazar un
 * expediente propio al cliente de otro usuario expondría su nombre/DNI en la
 * respuesta de este mismo endpoint).
 */
async function resolveOwnClienteId(rawClienteId, userId) {
    const clienteId = V.id(rawClienteId);
    if (!clienteId) return null;
    const { rows } = await pool.query(
        'SELECT id FROM clientes WHERE id=$1 AND usuario_id=$2', [clienteId, userId]
    );
    return rows.length ? clienteId : null;
}

router.get('/', async (req, res) => {
    const userId = req.query.user ? Number(req.query.user) : req.userId;
    if (Number(userId) !== Number(req.userId)) return res.status(403).json({ error: 'Forbidden' });
    try {
        const { rows } = await pool.query(
            'SELECT * FROM registros WHERE usuario_id = $1 ORDER BY id ASC', [userId]
        );
        res.json(rows.map(mapRow));
    } catch (err) {
        console.error(err.code || err.name); res.status(500).json({ error: 'Error interno' });
    }
});

router.post('/', async (req, res) => {
    const b = req.body || {};
    if (!V.str(b.nombre, L.nombre)) return res.status(400).json({ error: 'Nombre requerido' });
    try {
        const clienteId = await resolveOwnClienteId(b.clienteId, req.userId);
        const { rows } = await pool.query(
            `INSERT INTO registros (nombre, dni, n_expediente, euros, email, telefono,
             presentado, validado, pagado, n_talon, comentarios, estado, cliente_id, usuario_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
            [V.str(b.nombre, L.nombre), V.str(b.dni, L.dni), V.str(b.nExpediente, L.nExpediente),
             V.num(b.euros, { max: 1e7 }), V.str(b.email, L.email), V.str(b.telefono, L.telefono),
             V.bool(b.presentado), V.bool(b.validado), V.bool(b.pagado),
             V.str(b.nTalon, L.nTalon), V.str(b.comentarios, L.comentarios),
             V.estado(b.estado), clienteId, req.userId]
        );
        res.status(201).json(mapRow(rows[0]));
    } catch (err) {
        console.error(err.code || err.name); res.status(500).json({ error: 'Error interno' });
    }
});

router.put('/:id', async (req, res) => {
    const b = req.body || {};
    if (!V.id(req.params.id)) return res.status(400).json({ error: 'Identificador invalido' });
    try {
        const clienteId = await resolveOwnClienteId(b.clienteId, req.userId);
        const { rows } = await pool.query(
            `UPDATE registros SET nombre=$1, dni=$2, n_expediente=$3, euros=$4, email=$5,
             telefono=$6, presentado=$7, validado=$8, pagado=$9, n_talon=$10,
             comentarios=$11, estado=$12, cliente_id=$13, updated_at=EXTRACT(EPOCH FROM NOW())*1000
             WHERE id=$14 AND usuario_id=$15 RETURNING *`,
            [V.str(b.nombre, L.nombre), V.str(b.dni, L.dni), V.str(b.nExpediente, L.nExpediente),
             V.num(b.euros, { max: 1e7 }), V.str(b.email, L.email), V.str(b.telefono, L.telefono),
             V.bool(b.presentado), V.bool(b.validado), V.bool(b.pagado),
             V.str(b.nTalon, L.nTalon), V.str(b.comentarios, L.comentarios),
             V.estado(b.estado), clienteId, req.params.id, req.userId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        res.json(mapRow(rows[0]));
    } catch (err) {
        console.error(err.code || err.name); res.status(500).json({ error: 'Error interno' });
    }
});

router.delete('/:id', async (req, res) => {
    if (!V.id(req.params.id)) return res.status(400).json({ error: 'Identificador invalido' });
    try {
        await pool.query('DELETE FROM registros WHERE id=$1 AND usuario_id=$2', [req.params.id, req.userId]);
        res.status(204).send();
    } catch (err) {
        console.error(err.code || err.name); res.status(500).json({ error: 'Error interno' });
    }
});

module.exports = router;
