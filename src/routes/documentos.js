const router = require('express').Router({ mergeParams: true });
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const pool   = require('../db/pool');

const uploadDir = process.env.UPLOAD_DIR || './src/uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename:    (req, file, cb) => {
        const ext  = path.extname(file.originalname);
        const name = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
        cb(null, name);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: (Number(process.env.MAX_FILE_SIZE_MB) || 20) * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
                         'application/msword',
                         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        cb(null, allowed.includes(file.mimetype));
    }
});

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
            [req.params.registroId, req.file.originalname, req.file.mimetype,
             base + '/v1/registros/' + req.params.registroId + '/documentos/PENDING/file']
        );
        const doc = rows[0];
        const urlRemota = base + '/v1/registros/' + req.params.registroId + '/documentos/' + doc.id + '/file';
        await pool.query('UPDATE documentos_registro SET url_remota=$1 WHERE id=$2', [urlRemota, doc.id]);
        fs.renameSync(req.file.path, path.join(uploadDir, doc.id + path.extname(req.file.originalname)));
        await pool.query('UPDATE documentos_registro SET url_remota=$1 WHERE id=$2', [urlRemota, doc.id]);
        doc.url_remota = urlRemota;
        res.status(201).json(mapDoc(doc, base));
    } catch (err) {
        if (req.file) fs.unlink(req.file.path, () => {});
        console.error(err); res.status(500).json({ error: 'Error interno' });
    }
});

router.get('/:docId/file', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM documentos_registro WHERE id=$1 AND registro_id=$2',
            [req.params.docId, req.params.registroId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
        const doc = rows[0];
        const filePath = path.join(uploadDir, doc.id + path.extname(doc.nombre_archivo));
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado en disco' });
        res.setHeader('Content-Type', doc.tipo_mime || 'application/octet-stream');
        res.setHeader('Content-Disposition', 'inline; filename="' + doc.nombre_archivo + '"');
        res.sendFile(path.resolve(filePath));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

router.delete('/:docId', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'DELETE FROM documentos_registro WHERE id=$1 AND registro_id=$2 RETURNING *',
            [req.params.docId, req.params.registroId]
        );
        if (rows.length) {
            const filePath = path.join(uploadDir, rows[0].id + path.extname(rows[0].nombre_archivo));
            fs.unlink(filePath, () => {});
        }
        res.status(204).send();
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
});

module.exports = router;
