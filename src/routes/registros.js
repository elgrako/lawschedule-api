const router = require('express').Router();
const pool   = require('../db/pool');

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
        usuario_id:   Number(r.usuario_id)
    };
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
        console.error(err); res.status(500).json({ error: 'Error interno' });
    }
});

router.post('/', async (req, res) => {
    const b = req.body;
    try {
        const { rows } = await pool.query(
            `INSERT INTO registros (nombre, dni, n_expediente, euros, email, telefono,
             presentado, validado, pagado, n_talon, comentarios, estado, usuario_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [b.nombre, b.dni, b.nExpediente, b.euros||0, b.email, b.telefono,
             b.presentado||false, b.validado||false, b.pagado||false,
             b.nTalon, b.comentarios, b.estado||'PENDIENTE', req.userId]
        );
        res.status(201).json(mapRow(rows[0]));
    } catch (err) {
        console.error(err); res.status(500).json({ error: 'Error interno' });
    }
});

router.put('/:id', async (req, res) => {
    const b = req.body;
    try {
        const { rows } = await pool.query(
            `UPDATE registros SET nombre=$1, dni=$2, n_expediente=$3, euros=$4, email=$5,
             telefono=$6, presentado=$7, validado=$8, pagado=$9, n_talon=$10,
             comentarios=$11, estado=$12, updated_at=EXTRACT(EPOCH FROM NOW())*1000
             WHERE id=$13 AND usuario_id=$14 RETURNING *`,
            [b.nombre, b.dni, b.nExpediente, b.euros||0, b.email, b.telefono,
             b.presentado||false, b.validado||false, b.pagado||false,
             b.nTalon, b.comentarios, b.estado||'PENDIENTE',
             req.params.id, req.userId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        res.json(mapRow(rows[0]));
    } catch (err) {
        console.error(err); res.status(500).json({ error: 'Error interno' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM registros WHERE id=$1 AND usuario_id=$2', [req.params.id, req.userId]);
        res.status(204).send();
    } catch (err) {
        console.error(err); res.status(500).json({ error: 'Error interno' });
    }
});

module.exports = router;
