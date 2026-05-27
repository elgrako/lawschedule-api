const router = require('express').Router();
const pool   = require('../db/pool');

function mapGuardia(r) {
    return {
        id:                     Number(r.id),
        nombreAsistido:         r.nombre_asistido,
        diaActuacion:           r.dia_actuacion,
        porJuzgado:             r.por_juzgado,
        cobrado:                r.cobrado,
        juzgado:                r.juzgado,
        telefonoJuzgado:        r.telefono_juzgado,
        agenteJudicial:         r.agente_judicial,
        juez:                   r.juez,
        observacionesAsistido:  r.observaciones_asistido,
        usuario_id:             Number(r.usuario_id)
    };
}

function mapSituacion(r) {
    return { id: Number(r.id), guardia_id: Number(r.guardia_id), comentarios: r.comentarios,
             n_talon: r.n_talon, euros: Number(r.euros),
             presentado: r.presentado, validado: r.validado, pagado: r.pagado };
}

function mapApelacion(r) {
    return { id: Number(r.id), guardia_id: Number(r.guardia_id), n_expediente: r.n_expediente,
             admitido: r.admitido, presentado: r.presentado, sentencia: r.sentencia };
}

function mapRecurso(r) {
    return { id: Number(r.id), guardia_id: Number(r.guardia_id), n_expediente: r.n_expediente, resuelto: r.resuelto };
}

function mapRecursoExtra(r) {
    return { id: Number(r.id), guardia_id: Number(r.guardia_id), n_expediente: r.n_expediente, admitido: r.admitido };
}

// ── Guardias CRUD ──────────────────────────────────────────

router.get('/', async (req, res) => {
    const userId = req.query.user ? Number(req.query.user) : req.userId;
    if (Number(userId) !== Number(req.userId)) return res.status(403).json({ error: 'Forbidden' });
    try {
        const { rows } = await pool.query('SELECT * FROM guardias WHERE usuario_id=$1 ORDER BY dia_actuacion DESC', [userId]);
        res.json(rows.map(mapGuardia));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.post('/', async (req, res) => {
    const b = req.body;
    try {
        const { rows } = await pool.query(
            `INSERT INTO guardias (nombre_asistido, dia_actuacion, por_juzgado, cobrado,
             juzgado, telefono_juzgado, agente_judicial, juez, observaciones_asistido, usuario_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [b.nombreAsistido, b.diaActuacion, b.porJuzgado||false, b.cobrado||false,
             b.juzgado, b.telefonoJuzgado, b.agenteJudicial, b.juez,
             b.observacionesAsistido, req.userId]
        );
        res.status(201).json(mapGuardia(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.put('/:id', async (req, res) => {
    const b = req.body;
    try {
        const { rows } = await pool.query(
            `UPDATE guardias SET nombre_asistido=$1, dia_actuacion=$2, por_juzgado=$3, cobrado=$4,
             juzgado=$5, telefono_juzgado=$6, agente_judicial=$7, juez=$8,
             observaciones_asistido=$9, updated_at=EXTRACT(EPOCH FROM NOW())*1000
             WHERE id=$10 AND usuario_id=$11 RETURNING *`,
            [b.nombreAsistido, b.diaActuacion, b.porJuzgado||false, b.cobrado||false,
             b.juzgado, b.telefonoJuzgado, b.agenteJudicial, b.juez,
             b.observacionesAsistido, req.params.id, req.userId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        res.json(mapGuardia(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.delete('/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM guardias WHERE id=$1 AND usuario_id=$2', [req.params.id, req.userId]);
        res.status(204).send();
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

// ── Situaciones ────────────────────────────────────────────

router.get('/:guardiaId/situacion', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM situaciones_guardia WHERE guardia_id=$1', [req.params.guardiaId]);
        res.json(rows.map(mapSituacion));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.post('/:guardiaId/situacion', async (req, res) => {
    const b = req.body;
    try {
        const { rows } = await pool.query(
            `INSERT INTO situaciones_guardia (guardia_id, comentarios, n_talon, euros, presentado, validado, pagado)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [req.params.guardiaId, b.comentarios, b.nTalon||b.n_talon, b.euros||0,
             b.presentado||false, b.validado||false, b.pagado||false]
        );
        res.status(201).json(mapSituacion(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.put('/:guardiaId/situacion/:id', async (req, res) => {
    const b = req.body;
    try {
        const { rows } = await pool.query(
            `UPDATE situaciones_guardia SET comentarios=$1, n_talon=$2, euros=$3,
             presentado=$4, validado=$5, pagado=$6
             WHERE id=$7 AND guardia_id=$8 RETURNING *`,
            [b.comentarios, b.nTalon||b.n_talon, b.euros||0,
             b.presentado||false, b.validado||false, b.pagado||false,
             req.params.id, req.params.guardiaId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        res.json(mapSituacion(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.delete('/:guardiaId/situacion/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM situaciones_guardia WHERE id=$1 AND guardia_id=$2', [req.params.id, req.params.guardiaId]);
        res.status(204).send();
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

// ── Apelaciones ────────────────────────────────────────────

router.get('/:guardiaId/apelaciones', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM apelaciones_guardia WHERE guardia_id=$1', [req.params.guardiaId]);
        res.json(rows.map(mapApelacion));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.post('/:guardiaId/apelaciones', async (req, res) => {
    const b = req.body;
    try {
        const { rows } = await pool.query(
            `INSERT INTO apelaciones_guardia (guardia_id, n_expediente, admitido, presentado, sentencia)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [req.params.guardiaId, b.nExpediente||b.n_expediente, b.admitido||false, b.presentado||false, b.sentencia||false]
        );
        res.status(201).json(mapApelacion(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.put('/:guardiaId/apelaciones/:id', async (req, res) => {
    const b = req.body;
    try {
        const { rows } = await pool.query(
            `UPDATE apelaciones_guardia SET n_expediente=$1, admitido=$2, presentado=$3, sentencia=$4
             WHERE id=$5 AND guardia_id=$6 RETURNING *`,
            [b.nExpediente||b.n_expediente, b.admitido||false, b.presentado||false, b.sentencia||false,
             req.params.id, req.params.guardiaId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        res.json(mapApelacion(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.delete('/:guardiaId/apelaciones/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM apelaciones_guardia WHERE id=$1 AND guardia_id=$2', [req.params.id, req.params.guardiaId]);
        res.status(204).send();
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

// ── Recursos ───────────────────────────────────────────────

router.get('/:guardiaId/recurso', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM recursos_guardia WHERE guardia_id=$1', [req.params.guardiaId]);
        res.json(rows.map(mapRecurso));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.post('/:guardiaId/recurso', async (req, res) => {
    const b = req.body;
    try {
        const { rows } = await pool.query(
            `INSERT INTO recursos_guardia (guardia_id, n_expediente, resuelto) VALUES ($1,$2,$3) RETURNING *`,
            [req.params.guardiaId, b.nExpediente||b.n_expediente, b.resuelto||false]
        );
        res.status(201).json(mapRecurso(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.put('/:guardiaId/recurso/:id', async (req, res) => {
    const b = req.body;
    try {
        const { rows } = await pool.query(
            `UPDATE recursos_guardia SET n_expediente=$1, resuelto=$2 WHERE id=$3 AND guardia_id=$4 RETURNING *`,
            [b.nExpediente||b.n_expediente, b.resuelto||false, req.params.id, req.params.guardiaId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        res.json(mapRecurso(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.delete('/:guardiaId/recurso/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM recursos_guardia WHERE id=$1 AND guardia_id=$2', [req.params.id, req.params.guardiaId]);
        res.status(204).send();
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

// ── Recursos Extraordinarios ───────────────────────────────

router.get('/:guardiaId/recurso_extra', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM recursos_extra_ordinarios WHERE guardia_id=$1', [req.params.guardiaId]);
        res.json(rows.map(mapRecursoExtra));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.post('/:guardiaId/recurso_extra', async (req, res) => {
    const b = req.body;
    try {
        const { rows } = await pool.query(
            `INSERT INTO recursos_extra_ordinarios (guardia_id, n_expediente, admitido) VALUES ($1,$2,$3) RETURNING *`,
            [req.params.guardiaId, b.nExpediente||b.n_expediente, b.admitido||false]
        );
        res.status(201).json(mapRecursoExtra(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.put('/:guardiaId/recurso_extra/:id', async (req, res) => {
    const b = req.body;
    try {
        const { rows } = await pool.query(
            `UPDATE recursos_extra_ordinarios SET n_expediente=$1, admitido=$2 WHERE id=$3 AND guardia_id=$4 RETURNING *`,
            [b.nExpediente||b.n_expediente, b.admitido||false, req.params.id, req.params.guardiaId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        res.json(mapRecursoExtra(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.delete('/:guardiaId/recurso_extra/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM recursos_extra_ordinarios WHERE id=$1 AND guardia_id=$2', [req.params.id, req.params.guardiaId]);
        res.status(204).send();
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

module.exports = router;
