const router = require('express').Router();
const pool   = require('../db/pool');
const { ownsGuardia } = require('../middleware/ownership');
const V = require('../middleware/validate');
const L = V.LIMITS;
const { ALLOWED, sanitizeName, buildUpload } = require('../lib/uploads');

const upload = buildUpload();

// OWASP API1 (BOLA): toda subruta /:guardiaId/... verifica propiedad del padre.
// Sin esto, cualquier usuario autenticado podria leer/editar situaciones,
// apelaciones y recursos de guardias ajenas cambiando el id en la URL.
router.param('guardiaId', (req, res, next) => ownsGuardia(req, res, next));

function mapGuardia(r) {
    return {
        id:                     Number(r.id),
        diaGuardiaId:           r.dia_guardia_id != null ? Number(r.dia_guardia_id) : null,
        nombreAsistido:         r.nombre_asistido,
        cobrado:                r.cobrado,
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

function mapDocumento(r, baseUrl) {
    return {
        id:             Number(r.id),
        guardia_id:     Number(r.guardia_id),
        nombre_archivo: r.nombre_archivo,
        tipo_mime:      r.tipo_mime,
        fecha_agregado: Number(r.fecha_agregado),
        url_remota:     r.url_remota || (baseUrl + '/v1/guardias/' + r.guardia_id + '/documentos/' + r.id + '/file')
    };
}

// ── Guardias CRUD ──────────────────────────────────────────

router.get('/', async (req, res) => {
    const userId = req.query.user ? Number(req.query.user) : req.userId;
    if (Number(userId) !== Number(req.userId)) return res.status(403).json({ error: 'Forbidden' });
    try {
        const { rows } = await pool.query(
            `SELECT g.* FROM guardias g
             LEFT JOIN dias_guardia dg ON g.dia_guardia_id = dg.id
             WHERE g.usuario_id=$1
             ORDER BY dg.dia_actuacion DESC NULLS LAST, g.id DESC`,
            [userId]
        );
        res.json(rows.map(mapGuardia));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

// OWASP API1 (BOLA): diaGuardiaId llega en el body, no en la URL, asi que no puede
// pasar por router.param como :guardiaId. Se verifica pertenencia aqui mismo antes
// de crear/actualizar el asistido.
async function assertOwnsDiaGuardia(diaGuardiaId, userId) {
    const { rows } = await pool.query(
        'SELECT 1 FROM dias_guardia WHERE id=$1 AND usuario_id=$2 LIMIT 1', [diaGuardiaId, userId]
    );
    return rows.length > 0;
}

router.post('/', async (req, res) => {
    const b = req.body || {};
    const diaGuardiaId = V.id(b.diaGuardiaId);
    if (!diaGuardiaId) return res.status(400).json({ error: 'diaGuardiaId invalido' });
    try {
        if (!(await assertOwnsDiaGuardia(diaGuardiaId, req.userId))) {
            return res.status(404).json({ error: 'Dia de guardia no encontrado' });
        }
        const { rows } = await pool.query(
            `INSERT INTO guardias (dia_guardia_id, nombre_asistido, cobrado, observaciones_asistido, usuario_id)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [diaGuardiaId, V.str(b.nombreAsistido, L.nombreAsistido), V.bool(b.cobrado),
             V.str(b.observacionesAsistido, L.observacionesAsistido), req.userId]
        );
        res.status(201).json(mapGuardia(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.put('/:id', async (req, res) => {
    const b = req.body || {};
    if (!V.id(req.params.id)) return res.status(400).json({ error: 'Identificador invalido' });
    const diaGuardiaId = V.id(b.diaGuardiaId);
    if (!diaGuardiaId) return res.status(400).json({ error: 'diaGuardiaId invalido' });
    try {
        if (!(await assertOwnsDiaGuardia(diaGuardiaId, req.userId))) {
            return res.status(404).json({ error: 'Dia de guardia no encontrado' });
        }
        const { rows } = await pool.query(
            `UPDATE guardias SET dia_guardia_id=$1, nombre_asistido=$2, cobrado=$3,
             observaciones_asistido=$4, updated_at=EXTRACT(EPOCH FROM NOW())*1000
             WHERE id=$5 AND usuario_id=$6 RETURNING *`,
            [diaGuardiaId, V.str(b.nombreAsistido, L.nombreAsistido), V.bool(b.cobrado),
             V.str(b.observacionesAsistido, L.observacionesAsistido), req.params.id, req.userId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        res.json(mapGuardia(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.delete('/:id', async (req, res) => {
    if (!V.id(req.params.id)) return res.status(400).json({ error: 'Identificador invalido' });
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
    const b = req.body || {};
    try {
        const { rows } = await pool.query(
            `INSERT INTO situaciones_guardia (guardia_id, comentarios, n_talon, euros, presentado, validado, pagado)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [req.params.guardiaId, V.str(b.comentarios, L.comentarios), V.str(b.nTalon || b.n_talon, L.nTalon),
             V.num(b.euros, { max: 1e7 }), V.bool(b.presentado), V.bool(b.validado), V.bool(b.pagado)]
        );
        res.status(201).json(mapSituacion(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.put('/:guardiaId/situacion/:id', async (req, res) => {
    const b = req.body || {};
    if (!V.id(req.params.id)) return res.status(400).json({ error: 'Identificador invalido' });
    try {
        const { rows } = await pool.query(
            `UPDATE situaciones_guardia SET comentarios=$1, n_talon=$2, euros=$3,
             presentado=$4, validado=$5, pagado=$6
             WHERE id=$7 AND guardia_id=$8 RETURNING *`,
            [V.str(b.comentarios, L.comentarios), V.str(b.nTalon || b.n_talon, L.nTalon),
             V.num(b.euros, { max: 1e7 }), V.bool(b.presentado), V.bool(b.validado), V.bool(b.pagado),
             req.params.id, req.params.guardiaId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        res.json(mapSituacion(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.delete('/:guardiaId/situacion/:id', async (req, res) => {
    if (!V.id(req.params.id)) return res.status(400).json({ error: 'Identificador invalido' });
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
    const b = req.body || {};
    try {
        const { rows } = await pool.query(
            `INSERT INTO apelaciones_guardia (guardia_id, n_expediente, admitido, presentado, sentencia)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [req.params.guardiaId, V.str(b.nExpediente || b.n_expediente, L.nExpediente),
             V.bool(b.admitido), V.bool(b.presentado), V.bool(b.sentencia)]
        );
        res.status(201).json(mapApelacion(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.put('/:guardiaId/apelaciones/:id', async (req, res) => {
    const b = req.body || {};
    if (!V.id(req.params.id)) return res.status(400).json({ error: 'Identificador invalido' });
    try {
        const { rows } = await pool.query(
            `UPDATE apelaciones_guardia SET n_expediente=$1, admitido=$2, presentado=$3, sentencia=$4
             WHERE id=$5 AND guardia_id=$6 RETURNING *`,
            [V.str(b.nExpediente || b.n_expediente, L.nExpediente),
             V.bool(b.admitido), V.bool(b.presentado), V.bool(b.sentencia),
             req.params.id, req.params.guardiaId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        res.json(mapApelacion(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.delete('/:guardiaId/apelaciones/:id', async (req, res) => {
    if (!V.id(req.params.id)) return res.status(400).json({ error: 'Identificador invalido' });
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
    const b = req.body || {};
    try {
        const { rows } = await pool.query(
            `INSERT INTO recursos_guardia (guardia_id, n_expediente, resuelto) VALUES ($1,$2,$3) RETURNING *`,
            [req.params.guardiaId, V.str(b.nExpediente || b.n_expediente, L.nExpediente), V.bool(b.resuelto)]
        );
        res.status(201).json(mapRecurso(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.put('/:guardiaId/recurso/:id', async (req, res) => {
    const b = req.body || {};
    if (!V.id(req.params.id)) return res.status(400).json({ error: 'Identificador invalido' });
    try {
        const { rows } = await pool.query(
            `UPDATE recursos_guardia SET n_expediente=$1, resuelto=$2 WHERE id=$3 AND guardia_id=$4 RETURNING *`,
            [V.str(b.nExpediente || b.n_expediente, L.nExpediente), V.bool(b.resuelto), req.params.id, req.params.guardiaId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        res.json(mapRecurso(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.delete('/:guardiaId/recurso/:id', async (req, res) => {
    if (!V.id(req.params.id)) return res.status(400).json({ error: 'Identificador invalido' });
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
    const b = req.body || {};
    try {
        const { rows } = await pool.query(
            `INSERT INTO recursos_extra_ordinarios (guardia_id, n_expediente, admitido) VALUES ($1,$2,$3) RETURNING *`,
            [req.params.guardiaId, V.str(b.nExpediente || b.n_expediente, L.nExpediente), V.bool(b.admitido)]
        );
        res.status(201).json(mapRecursoExtra(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.put('/:guardiaId/recurso_extra/:id', async (req, res) => {
    const b = req.body || {};
    if (!V.id(req.params.id)) return res.status(400).json({ error: 'Identificador invalido' });
    try {
        const { rows } = await pool.query(
            `UPDATE recursos_extra_ordinarios SET n_expediente=$1, admitido=$2 WHERE id=$3 AND guardia_id=$4 RETURNING *`,
            [V.str(b.nExpediente || b.n_expediente, L.nExpediente), V.bool(b.admitido), req.params.id, req.params.guardiaId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        res.json(mapRecursoExtra(rows[0]));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.delete('/:guardiaId/recurso_extra/:id', async (req, res) => {
    if (!V.id(req.params.id)) return res.status(400).json({ error: 'Identificador invalido' });
    try {
        await pool.query('DELETE FROM recursos_extra_ordinarios WHERE id=$1 AND guardia_id=$2', [req.params.id, req.params.guardiaId]);
        res.status(204).send();
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

// ── Documentos adjuntos ────────────────────────────────────

router.get('/:guardiaId/documentos', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, guardia_id, nombre_archivo, tipo_mime, fecha_agregado, url_remota FROM documentos_guardia WHERE guardia_id=$1 ORDER BY fecha_agregado ASC',
            [req.params.guardiaId]
        );
        const base = req.protocol + '://' + req.get('host');
        res.json(rows.map(r => mapDocumento(r, base)));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.post('/:guardiaId/documentos', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const base = req.protocol + '://' + req.get('host');
    try {
        const { rows } = await pool.query(
            `INSERT INTO documentos_guardia (guardia_id, nombre_archivo, tipo_mime, url_remota, contenido)
             VALUES ($1,$2,$3,$4,$5) RETURNING id, guardia_id, nombre_archivo, tipo_mime, fecha_agregado, url_remota`,
            [req.params.guardiaId, sanitizeName(req.file.originalname), req.file.mimetype,
             base + '/v1/guardias/' + req.params.guardiaId + '/documentos/PENDING/file', req.file.buffer]
        );
        const doc = rows[0];
        const urlRemota = base + '/v1/guardias/' + req.params.guardiaId + '/documentos/' + doc.id + '/file';
        await pool.query('UPDATE documentos_guardia SET url_remota=$1 WHERE id=$2', [urlRemota, doc.id]);
        doc.url_remota = urlRemota;
        res.status(201).json(mapDocumento(doc, base));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.get('/:guardiaId/documentos/:docId/file', async (req, res) => {
    if (!V.id(req.params.docId)) return res.status(400).json({ error: 'Identificador invalido' });
    try {
        const { rows } = await pool.query(
            'SELECT nombre_archivo, tipo_mime, contenido FROM documentos_guardia WHERE id=$1 AND guardia_id=$2',
            [req.params.docId, req.params.guardiaId]
        );
        if (!rows.length || !rows[0].contenido) return res.status(404).json({ error: 'No encontrado' });
        const doc = rows[0];
        const mime = ALLOWED[doc.tipo_mime] ? doc.tipo_mime : 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('Content-Disposition',
            'attachment; filename="' + sanitizeName(doc.nombre_archivo) + '"');
        res.send(doc.contenido);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.delete('/:guardiaId/documentos/:docId', async (req, res) => {
    if (!V.id(req.params.docId)) return res.status(400).json({ error: 'Identificador invalido' });
    try {
        await pool.query('DELETE FROM documentos_guardia WHERE id=$1 AND guardia_id=$2', [req.params.docId, req.params.guardiaId]);
        res.status(204).send();
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

module.exports = router;
