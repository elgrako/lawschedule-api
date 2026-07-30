const jwt = require('jsonwebtoken');

const JWT_ALG = 'HS256';

module.exports = function authMiddleware(req, res, next) {
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token requerido' });
    }
    const token = header.slice(7).trim();
    if (!token) return res.status(401).json({ error: 'Token requerido' });

    try {
        // algorithms fijado: impide ataques de confusion de algoritmo
        // ("alg": "none" o cambio HS256->RS256 con clave publica conocida).
        const payload = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: [JWT_ALG],
            issuer: 'lawschedule-api',
            audience: 'lawschedule-app',
            clockTolerance: 5
        });
        const sub = Number(payload.sub);
        if (!Number.isSafeInteger(sub) || sub <= 0) {
            return res.status(401).json({ error: 'Token invalido' });
        }
        req.userId = sub;
        next();
    } catch {
        return res.status(401).json({ error: 'Token invalido o expirado' });
    }
};

module.exports.JWT_ALG = JWT_ALG;
