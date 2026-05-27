const router  = require('express').Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const pool    = require('../db/pool');

const SALT_ROUNDS = 12;

function makeToken(userId) {
    return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '30d'
    });
}

function mapUser(row) {
    return { id: Number(row.id), email: row.email, nombre: row.nombre, created_at: Number(row.created_at) };
}

router.post('/register', async (req, res) => {
    const { email, nombre, password } = req.body;
    if (!email || !nombre || !password) return res.status(400).json({ error: 'Faltan campos' });
    if (password.length < 8)           return res.status(400).json({ error: 'Contraseña mínima 8 caracteres' });

    try {
        const hash = await bcrypt.hash(password, SALT_ROUNDS);
        const { rows } = await pool.query(
            'INSERT INTO usuarios (email, nombre, password_hash) VALUES ($1, $2, $3) RETURNING *',
            [email.trim().toLowerCase(), nombre.trim(), hash]
        );
        const user = rows[0];
        res.status(201).json({ usuario: mapUser(user), token: makeToken(user.id) });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Email ya registrado' });
        console.error(err);
        res.status(500).json({ error: 'Error interno' });
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(401).json({ error: 'Credenciales incorrectas' });

    try {
        const { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email.trim().toLowerCase()]);
        const user = rows[0];
        if (!user) {
            await bcrypt.hash('dummy', SALT_ROUNDS);
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' });

        res.json({ usuario: mapUser(user), token: makeToken(user.id) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error interno' });
    }
});

module.exports = router;
