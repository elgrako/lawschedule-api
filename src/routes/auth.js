const router  = require('express').Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');
const { JWT_ALG } = auth;

const SALT_ROUNDS   = 12;
const MAX_EMAIL_LEN = 120;
const MAX_NOMBRE    = 200;
const MAX_PASSWORD  = 200;   // corta ataques de DoS por bcrypt con entradas enormes
const MIN_PASSWORD  = 10;

const EMAIL_RE = /^[^@\s]{1,64}@[^@\s.]+(\.[^@\s.]+)+$/;

// Bloqueo por cuenta (complementa el rate limit por IP de app.js).
// En memoria: suficiente para una sola instancia; con varias, mover a Redis/BD.
const LOCK_THRESHOLD = 8;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map();

function failureKey(email) {
    return crypto.createHash('sha256').update(String(email)).digest('hex');
}

function isLocked(email) {
    const e = failures.get(failureKey(email));
    if (!e) return false;
    if (Date.now() - e.first > LOCK_WINDOW_MS) { failures.delete(failureKey(email)); return false; }
    return e.count >= LOCK_THRESHOLD;
}

function recordFailure(email) {
    const k = failureKey(email);
    const e = failures.get(k);
    if (!e || Date.now() - e.first > LOCK_WINDOW_MS) failures.set(k, { count: 1, first: Date.now() });
    else e.count++;
}

function clearFailures(email) { failures.delete(failureKey(email)); }

// Limpieza periodica para que el Map no crezca sin limite (DoS de memoria).
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of failures) if (now - v.first > LOCK_WINDOW_MS) failures.delete(k);
}, LOCK_WINDOW_MS).unref();

function makeToken(userId, tokenVersion) {
    return jwt.sign({ sub: String(userId), tokenVersion: tokenVersion || 0 }, process.env.JWT_SECRET, {
        algorithm: JWT_ALG,
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
        issuer:   'lawschedule-api',
        audience: 'lawschedule-app',
        jwtid:    crypto.randomUUID()
    });
}

function mapUser(row) {
    return { id: Number(row.id), email: row.email, nombre: row.nombre, created_at: Number(row.created_at) };
}

function validPassword(p) {
    if (typeof p !== 'string') return 'Contrasena requerida';
    if (p.length < MIN_PASSWORD) return 'La contrasena debe tener al menos ' + MIN_PASSWORD + ' caracteres';
    if (p.length > MAX_PASSWORD) return 'Contrasena demasiado larga';
    let clases = 0;
    if (/[a-z]/.test(p)) clases++;
    if (/[A-Z]/.test(p)) clases++;
    if (/\d/.test(p))    clases++;
    if (/[^A-Za-z0-9]/.test(p)) clases++;
    if (clases < 3) return 'La contrasena debe combinar mayusculas, minusculas, numeros o simbolos';
    return null;
}

router.post('/register', async (req, res) => {
    const { email, nombre, password } = req.body || {};
    if (typeof email !== 'string' || typeof nombre !== 'string') {
        return res.status(400).json({ error: 'Faltan campos' });
    }
    const mail = email.trim().toLowerCase();
    const name = nombre.trim();
    if (!mail || !name)              return res.status(400).json({ error: 'Faltan campos' });
    if (mail.length > MAX_EMAIL_LEN) return res.status(400).json({ error: 'Email demasiado largo' });
    if (!EMAIL_RE.test(mail))        return res.status(400).json({ error: 'Email invalido' });
    if (name.length > MAX_NOMBRE)    return res.status(400).json({ error: 'Nombre demasiado largo' });

    const pwdError = validPassword(password);
    if (pwdError) return res.status(400).json({ error: pwdError });

    try {
        const hash = await bcrypt.hash(password, SALT_ROUNDS);
        const { rows } = await pool.query(
            'INSERT INTO usuarios (email, nombre, password_hash) VALUES ($1, $2, $3) RETURNING *',
            [mail, name, hash]
        );
        const user = rows[0];
        res.status(201).json({ usuario: mapUser(user), token: makeToken(user.id, user.token_version) });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Email ya registrado' });
        console.error('[auth/register]', err.code || err.name);
        res.status(500).json({ error: 'Error interno' });
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
        return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    if (email.length > MAX_EMAIL_LEN || password.length > MAX_PASSWORD) {
        return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    const mail = email.trim().toLowerCase();

    if (isLocked(mail)) {
        return res.status(429).json({ error: 'Cuenta bloqueada temporalmente por intentos fallidos' });
    }

    try {
        const { rows } = await pool.query(
            'SELECT id, email, nombre, password_hash, created_at, token_version FROM usuarios WHERE email = $1',
            [mail]
        );
        const user = rows[0];
        if (!user) {
            // Trabajo equivalente al de un hash real: evita distinguir por tiempo
            // si el email existe (user enumeration).
            await bcrypt.compare(password, '$2b$12$' + 'x'.repeat(53));
            recordFailure(mail);
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) {
            recordFailure(mail);
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }
        clearFailures(mail);
        res.json({ usuario: mapUser(user), token: makeToken(user.id, user.token_version) });
    } catch (err) {
        console.error('[auth/login]', err.code || err.name);
        res.status(500).json({ error: 'Error interno' });
    }
});

router.post('/change-password', auth, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || !currentPassword) {
        return res.status(400).json({ error: 'Contrasena actual requerida' });
    }
    if (currentPassword.length > MAX_PASSWORD) {
        return res.status(401).json({ error: 'Contrasena actual incorrecta' });
    }
    const pwdError = validPassword(newPassword);
    if (pwdError) return res.status(400).json({ error: pwdError });

    // Bloqueo por cuenta igual que /login (namespaced aparte: un JWT robado no
    // debe poder fuerza-bruta la contrasena actual rotando de IP — antes de
    // este fix solo el rate limit por IP de app.js cubria esta ruta).
    const lockKey = 'cp:' + req.userId;
    if (isLocked(lockKey)) {
        return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' });
    }

    try {
        const { rows } = await pool.query(
            'SELECT password_hash FROM usuarios WHERE id = $1',
            [req.userId]
        );
        const user = rows[0];
        if (!user) return res.status(401).json({ error: 'Contrasena actual incorrecta' });

        const ok = await bcrypt.compare(currentPassword, user.password_hash);
        if (!ok) {
            recordFailure(lockKey);
            return res.status(401).json({ error: 'Contrasena actual incorrecta' });
        }
        clearFailures(lockKey);

        const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
        // token_version + 1 revoca de inmediato TODOS los tokens ya emitidos
        // (robado o no) — se reemite uno nuevo aqui mismo para no cerrar esta sesion.
        const { rows: updated } = await pool.query(
            'UPDATE usuarios SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING token_version',
            [hash, req.userId]
        );
        res.json({ ok: true, token: makeToken(req.userId, updated[0].token_version) });
    } catch (err) {
        console.error('[auth/change-password]', err.code || err.name);
        res.status(500).json({ error: 'Error interno' });
    }
});

module.exports = router;
