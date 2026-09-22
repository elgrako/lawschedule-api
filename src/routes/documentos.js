const router = require('express').Router({ mergeParams: true });
const path   = require('path');
const fs     = require('fs');
const pool   = require('../db/pool');
const V      = require('../middleware/validate');
const { ALLOWED, safeExt, sanitizeName, uploadDir: getUploadDir, buildUpload } = require('../lib/uploads');

const uploadDir = getUploadDir();
const upload = buildUpload(uploadDir);

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
            'SELECT * FROM documentos_registro WHERE registro_id=$1 ORDER BY fecha_agregado ASC',
            [req.params.registroId]
        );
        const base = req.protocol + '://' + req.get('host');
        res.json(rows.map(r => mapDoc(r, base)));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.post('/', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const base = req.protocol + '://' + req.get('host');
    try {
        const { rows } = await pool.query(
            `INSERT INTO documentos_registro (registro_id, nombre_archivo, tipo_mime, url_remota)
             VALUES ($1,$2,$3,$4) RETURNING *`,
            [req.params.registroId, sanitizeName(req.file.originalname), req.file.mimetype,
             base + '/v1/registros/' + req.params.registroId + '/documentos/PENDING/file']
        );
        const doc = rows[0];
        const urlRemota = base + '/v1/registros/' + req.params.registroId + '/documentos/' + doc.id + '/file';
        await pool.query('UPDATE documentos_registro SET url_remota=$1 WHERE id=$2', [urlRemota, doc.id]);
        const ext = safeExt(req.file.originalname, req.file.mimetype) || '.bin';
        fs.renameSync(req.file.path, path.join(uploadDir, String(doc.id) + ext));
        doc.url_remota = urlRemota;
        res.status(201).json(mapDoc(doc, base));
    } catch (err) {
        if (req.file) fs.unlink(req.file.path, () => {});
        console.error(err); res.status(500).json({ error: 'Error interno' });
    }
});

router.get('/:docId/file', async (req, res) => {
    if (!V.id(req.params.docId)) return res.status(400).json({ error: 'Identificador invalido' });
    try {
        const { rows } = await pool.query(
            'SELECT * FROM documentos_registro WHERE id=$1 AND registro_id=$2',
            [req.params.docId, req.params.registroId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        const doc = rows[0];
        const ext = path.extname(String(doc.nombre_archivo || '')).toLowerCase();
        const filePath = path.resolve(uploadDir, String(doc.id) + ext);
        // El fichero resultante debe seguir dentro de uploadDir (defensa path traversal).
        if (!filePath.startsWith(path.resolve(uploadDir) + path.sep)) {
            return res.status(400).json({ error: 'Ruta invalida' });
        }
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado en disco' });

        const mime = ALLOWED[doc.tipo_mime] ? doc.tipo_mime : 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        // attachment (no inline): impide que el navegador ejecute el contenido en el
        // origen de la API si algun dia se sube un tipo renderizable.
        res.setHeader('Content-Disposition',
            'attachment; filename="' + sanitizeName(doc.nombre_archivo) + '"');
        res.sendFile(filePath);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.delete('/:docId', async (req, res) => {
    if (!V.id(req.params.docId)) return res.status(400).json({ error: 'Identificador invalido' });
    try {
        const { rows } = await pool.query(
            'DELETE FROM documentos_registro WHERE id=$1 AND registro_id=$2 RETURNING *',
            [req.params.docId, req.params.registroId]
        );
        if (rows.length) {
            const ext = path.extname(String(rows[0].nombre_archivo || '')).toLowerCase();
            const filePath = path.resolve(uploadDir, String(rows[0].id) + ext);
            if (filePath.startsWith(path.resolve(uploadDir) + path.sep)) fs.unlink(filePath, () => {});
        }
        res.status(204).send();
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

module.exports = router;
