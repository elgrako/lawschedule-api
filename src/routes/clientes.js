const router = require('express').Router();
const pool   = require('../db/pool');
const V      = require('../middleware/validate');
const L      = V.LIMITS;

function mapRow(r) {
    return {
        id:         Number(r.id),
        nombre:     r.nombre,
        dniNif:     r.dni_nif,
        email:      r.email,
        telefono:   r.telefono,
        direccion:  r.direccion,
        notas:      r.notas,
        usuario_id: Number(r.usuario_id)
    };
}

router.get('/', async (req, res) => {
    const userId = req.query.user ? Number(req.query.user) : req.userId;
    if (Number(userId) !== Number(req.userId)) return res.status(403).json({ error: 'Forbidden' });
    try {
        const { rows } = await pool.query(
            'SELECT * FROM clientes WHERE usuario_id = $1 ORDER BY nombre ASC', [userId]
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
        const { rows } = await pool.query(
            `INSERT INTO clientes (nombre, dni_nif, email, telefono, direccion, notas, usuario_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [V.str(b.nombre, L.nombre), V.str(b.dniNif, L.dni), V.str(b.email, L.email),
             V.str(b.telefono, L.telefono), V.str(b.direccion, L.direccion),
             V.str(b.notas, L.notas), req.userId]
        );
        res.status(201).json(mapRow(rows[0]));
    } catch (err) {
        console.error(err.code || err.name); res.status(500).json({ error: 'Error interno' });
    }
});

router.put('/:id', async (req, res) => {
    const b = req.body || {};
    if (!V.id(req.params.id)) return res.status(400).json({ error: 'Identificador invalido' });
    if (!V.str(b.nombre, L.nombre)) return res.status(400).json({ error: 'Nombre requerido' });
    try {
        const { rows } = await pool.query(
            `UPDATE clientes SET nombre=$1, dni_nif=$2, email=$3, telefono=$4, direccion=$5,
             notas=$6, updated_at=EXTRACT(EPOCH FROM NOW())*1000
             WHERE id=$7 AND usuario_id=$8 RETURNING *`,
            [V.str(b.nombre, L.nombre), V.str(b.dniNif, L.dni), V.str(b.email, L.email),
             V.str(b.telefono, L.telefono), V.str(b.direccion, L.direccion),
             V.str(b.notas, L.notas), req.params.id, req.userId]
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
        // ON DELETE SET NULL en registros.cliente_id: los expedientes del cliente
        // se desvinculan solos, nunca se borran junto con el cliente.
        await pool.query('DELETE FROM clientes WHERE id=$1 AND usuario_id=$2', [req.params.id, req.userId]);
        res.status(204).send();
    } catch (err) {
        console.error(err.code || err.name); res.status(500).json({ error: 'Error interno' });
    }
});

module.exports = router;
