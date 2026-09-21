const jwt  = require('jsonwebtoken');
const pool = require('../db/pool');

const JWT_ALG = 'HS256';

module.exports = async function authMiddleware(req, res, next) {
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token requerido' });
    }
    const token = header.slice(7).trim();
    if (!token) return res.status(401).json({ error: 'Token requerido' });

    let payload;
    try {
        // algorithms fijado: impide ataques de confusion de algoritmo
        // ("alg": "none" o cambio HS256->RS256 con clave publica conocida).
        payload = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: [JWT_ALG],
            issuer: 'lawschedule-api',
            audience: 'lawschedule-app',
            clockTolerance: 5
        });
    } catch {
        return res.status(401).json({ error: 'Token invalido o expirado' });
    }

    const sub = Number(payload.sub);
    if (!Number.isSafeInteger(sub) || sub <= 0) {
        return res.status(401).json({ error: 'Token invalido' });
    }

    try {
        // Revocacion server-side: si el token_version de la BD ya no coincide
        // con el que traia el JWT (p.ej. tras un cambio de contrasena), el
        // token queda muerto aunque su firma y expiracion sigan siendo validas.
        const { rows } = await pool.query('SELECT token_version FROM usuarios WHERE id = $1', [sub]);
        const user = rows[0];
        if (!user || Number(user.token_version) !== Number(payload.tokenVersion || 0)) {
            return res.status(401).json({ error: 'Token invalido o expirado' });
        }
    } catch (err) {
        console.error('[auth middleware]', err.code || err.name);
        return res.status(500).json({ error: 'Error interno' });
    }

    req.userId = sub;
    next();
};

module.exports.JWT_ALG = JWT_ALG;
