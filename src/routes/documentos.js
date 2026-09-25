const router = require('express').Router({ mergeParams: true });
const pool   = require('../db/pool');
const V      = require('../middleware/validate');
const { ALLOWED, sanitizeName, buildUpload } = require('../lib/uploads');

const upload = buildUpload();

function mapDoc(r, baseUrl) {
    return {
        id:             Number(r.id),
        registro_id:    Number(r.registro_id),
        nombre_archivo: r.nombre_archivo,
        tipo_mime:      r.tipo_mime,
        fecha_agregado: Number(r.fecha_agregado),
        url_remota:     r.url_remota || (baseUrl + '/v1/registros/' + r.registro_id + '/documentos/' + r.id + '/file')
    };
}

router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, registro_id, nombre_archivo, tipo_mime, fecha_agregado, url_remota FROM documentos_registro WHERE registro_id=$1 ORDER BY fecha_agregado ASC',
            [req.params.registroId]
        );
        const base = req.protocol + '://' + req.get('host');
        res.json(rows.map(r => mapDoc(r, base)));
    } catch (err) { console.error(err.code || err.name); res.status(500).json({ error: 'Error interno' }); }
});

router.post('/', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const base = req.protocol + '://' + req.get('host');
    try {
        const { rows } = await pool.query(
            `INSERT INTO documentos_registro (registro_id, nombre_archivo, tipo_mime, url_remota, contenido)
             VALUES ($1,$2,$3,$4,$5) RETURNING id, registro_id, nombre_archivo, tipo_mime, fecha_agregado, url_remota`,
            [req.params.registroId, sanitizeName(req.file.originalname), req.file.mimetype,
             base + '/v1/registros/' + req.params.registroId + '/documentos/PENDING/file', req.file.buffer]
        );
        const doc = rows[0];
        const urlRemota = base + '/v1/registros/' + req.params.registroId + '/documentos/' + doc.id + '/file';
        await pool.query('UPDATE documentos_registro SET url_remota=$1 WHERE id=$2', [urlRemota, doc.id]);
        doc.url_remota = urlRemota;
        res.status(201).json(mapDoc(doc, base));
    } catch (err) { console.error(err.code || err.name); res.status(500).json({ error: 'Error interno' }); }
});

router.get('/:docId/file', async (req, res) => {
    if (!V.id(req.params.docId)) return res.status(400).json({ error: 'Identificador invalido' });
    try {
        const { rows } = await pool.query(
            'SELECT nombre_archivo, tipo_mime, contenido FROM documentos_registro WHERE id=$1 AND registro_id=$2',
            [req.params.docId, req.params.registroId]
        );
        if (!rows.length || !rows[0].contenido) return res.status(404).json({ error: 'No encontrado' });
        const doc = rows[0];
        const mime = ALLOWED[doc.tipo_mime] ? doc.tipo_mime : 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        // attachment (no inline): impide que el navegador ejecute el contenido en el
        // origen de la API si algun dia se sube un tipo renderizable.
        res.setHeader('Content-Disposition',
            'attachment; filename="' + sanitizeName(doc.nombre_archivo) + '"');
        res.send(doc.contenido);
    } catch (err) { console.error(err.code || err.name); res.status(500).json({ error: 'Error interno' }); }
});

router.delete('/:docId', async (req, res) => {
    if (!V.id(req.params.docId)) return res.status(400).json({ error: 'Identificador invalido' });
    try {
        await pool.query('DELETE FROM documentos_registro WHERE id=$1 AND registro_id=$2', [req.params.docId, req.params.registroId]);
        res.status(204).send();
    } catch (err) { console.error(err.code || err.name); res.status(500).json({ error: 'Error interno' }); }
});

module.exports = router;
