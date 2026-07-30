const router = require('express').Router({ mergeParams: true });
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const pool   = require('../db/pool');

const uploadDir = process.env.UPLOAD_DIR || './src/uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Extension y mimetype deben coincidir con la whitelist. El mimetype lo envia
// el cliente y no es de fiar por si solo.
const ALLOWED = {
    'application/pdf':  ['.pdf'],
    'image/jpeg':       ['.jpg', '.jpeg'],
    'image/png':        ['.png'],
    'image/webp':       ['.webp'],
    'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
};

function safeExt(originalname, mimetype) {
    const ext = path.extname(String(originalname || '')).toLowerCase();
    const allowed = ALLOWED[mimetype];
    if (!allowed || !allowed.includes(ext)) return null;
    return ext;
}

// Nombre visible saneado: sin rutas, sin caracteres de control ni comillas
// (evita path traversal e inyeccion en la cabecera Content-Disposition).
function sanitizeName(name) {
    return path.basename(String(name || 'documento'))
        .replace(/[\r\n"\\]/g, '')
        .replace(/[^\w.\- ()]/g, '_')
        .slice(0, 120) || 'documento';
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename:    (req, file, cb) => {
        const ext = safeExt(file.originalname, file.mimetype) || '.bin';
        cb(null, Date.now() + '-' + crypto.randomBytes(8).toString('hex') + ext);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: (Number(process.env.MAX_FILE_SIZE_MB) || 20) * 1024 * 1024,
        files: 1,
        parts: 10
    },
    fileFilter: (req, file, cb) => cb(null, safeExt(file.originalname, file.mimetype) !== null)
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
            [req.params.registroId, sanitizeName(req.file.originalname), req.file.mimetype,
             base + '/v1/registros/' + req.params.registroId + '/documentos/PENDING/file']
        );
        const doc = rows[0];
        const urlRemota = base + '/v1/registros/' + req.params.registroId + '/documentos/' + doc.id + '/file';
        await pool.query('UPDATE documentos_registro SET url_remota=$1 WHERE id=$2', [urlRemota, doc.id]);
        const ext = safeExt(req.file.originalname, req.file.mimetype) || '.bin';
        fs.renameSync(req.file.path, path.join(uploadDir, String(doc.id) + ext));
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
