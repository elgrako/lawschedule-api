const multer = require('multer');
const path   = require('path');

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

// memoryStorage: el fichero llega entero en req.file.buffer, sin tocar disco.
// La API se aloja en Render (filesystem efimero, se borra en cada redeploy) --
// el contenido real se persiste como BYTEA en Neon junto al resto de datos,
// que es lo unico duradero en este despliegue.
function buildUpload() {
    return multer({
        storage: multer.memoryStorage(),
        limits: {
            fileSize: (Number(process.env.MAX_FILE_SIZE_MB) || 20) * 1024 * 1024,
            files: 1,
            parts: 10
        },
        fileFilter: (req, file, cb) => cb(null, safeExt(file.originalname, file.mimetype) !== null)
    });
}

// memoryStorage: cada subida en curso retiene su buffer (hasta 20MB) en RAM. Con
// ~512MB en el plan free, sin tope unas pocas subidas simultaneas tumban el proceso.
// Se limita el numero de subidas en vuelo; el resto recibe 503 y reintenta el cliente.
const MAX_CONCURRENT_UPLOADS = Number(process.env.MAX_CONCURRENT_UPLOADS) || 4;
let uploadsInFlight = 0;
function limitUploads(req, res, next) {
    if (uploadsInFlight >= MAX_CONCURRENT_UPLOADS) {
        return res.status(503).json({ error: 'Demasiadas subidas en curso, intentalo de nuevo en unos segundos' });
    }
    uploadsInFlight++;
    let released = false;
    const release = () => { if (!released) { released = true; uploadsInFlight--; } };
    res.on('finish', release);
    res.on('close', release);
    next();
}

module.exports = { ALLOWED, safeExt, sanitizeName, buildUpload, limitUploads };
