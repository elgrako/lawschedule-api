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

module.exports = { ALLOWED, safeExt, sanitizeName, buildUpload };
