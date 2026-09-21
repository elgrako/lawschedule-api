const router = require('express').Router();
const pool   = require('../db/pool');
const V      = require('../middleware/validate');
const L      = V.LIMITS;

function mapRow(r) {
    return {
        id:              Number(r.id),
        diaActuacion:    r.dia_actuacion,
        porJuzgado:      r.por_juzgado,
        juzgado:         r.juzgado,
        telefonoJuzgado: r.telefono_juzgado,
        agenteJudicial:  r.agente_judicial,
        juez:            r.juez,
        observaciones:   r.observaciones,
        usuario_id:      Number(r.usuario_id)
    };
}

router.get('/', async (req, res) => {
    const userId = req.query.user ? Number(req.query.user) : req.userId;
    if (Number(userId) !== Number(req.userId)) return res.status(403).json({ error: 'Forbidden' });
    try {
        const { rows } = await pool.query(
            'SELECT * FROM dias_guardia WHERE usuario_id=$1 ORDER BY dia_actuacion DESC', [userId]
        );
        res.json(rows.map(mapRow));
    } catch (err) {
        console.error(err); res.status(500).json({ error: 'Error interno' });
    }
});

router.post('/', async (req, res) => {
    const b = req.body || {};
    if (!b.diaActuacion) return res.status(400).json({ error: 'Fecha de guardia requerida' });
    try {
        const { rows } = await pool.query(
            `INSERT INTO dias_guardia (usuario_id, dia_actuacion, por_juzgado, juzgado,
             telefono_juzgado, agente_judicial, juez, observaciones)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [req.userId, b.diaActuacion, V.bool(b.porJuzgado), V.str(b.juzgado, L.juzgado),
             V.str(b.telefonoJuzgado, L.telefonoJuzgado), V.str(b.agenteJudicial, L.agenteJudicial),
             V.str(b.juez, L.juez), V.str(b.observaciones, L.observaciones)]
        );
        res.status(201).json(mapRow(rows[0]));
    } catch (err) {
        console.error(err); res.status(500).json({ error: 'Error interno' });
    }
});

router.put('/:id', async (req, res) => {
    const b = req.body || {};
    if (!V.id(req.params.id)) return res.status(400).json({ error: 'Identificador invalido' });
    if (!b.diaActuacion) return res.status(400).json({ error: 'Fecha de guardia requerida' });
    try {
        const { rows } = await pool.query(
            `UPDATE dias_guardia SET dia_actuacion=$1, por_juzgado=$2, juzgado=$3,
             telefono_juzgado=$4, agente_judicial=$5, juez=$6, observaciones=$7,
             updated_at=EXTRACT(EPOCH FROM NOW())*1000
             WHERE id=$8 AND usuario_id=$9 RETURNING *`,
            [b.diaActuacion, V.bool(b.porJuzgado), V.str(b.juzgado, L.juzgado),
             V.str(b.telefonoJuzgado, L.telefonoJuzgado), V.str(b.agenteJudicial, L.agenteJudicial),
             V.str(b.juez, L.juez), V.str(b.observaciones, L.observaciones),
             req.params.id, req.userId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        res.json(mapRow(rows[0]));
    } catch (err) {
        console.error(err); res.status(500).json({ error: 'Error interno' });
    }
});

router.delete('/:id', async (req, res) => {
    if (!V.id(req.params.id)) return res.status(400).json({ error: 'Identificador invalido' });
    try {
        // ON DELETE CASCADE en guardias.dia_guardia_id se encarga de los asistidos del dia
        // (y, en cadena, de sus situaciones/apelaciones/recursos vía guardias.id CASCADE).
        await pool.query('DELETE FROM dias_guardia WHERE id=$1 AND usuario_id=$2', [req.params.id, req.userId]);
        res.status(204).send();
    } catch (err) {
        console.error(err); res.status(500).json({ error: 'Error interno' });
    }
});

module.exports = router;
