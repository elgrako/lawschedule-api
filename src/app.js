const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const auth       = require('./middleware/auth');
const { ownsRegistro } = require('./middleware/ownership');

const authRoutes       = require('./routes/auth');
const registrosRoutes  = require('./routes/registros');
const guardiasRoutes   = require('./routes/guardias');
const diasGuardiaRoutes = require('./routes/dias-guardia');
const documentosRoutes = require('./routes/documentos');
const clientesRoutes   = require('./routes/clientes');

const app = express();

// Detras del proxy de Render: sin esto, express-rate-limit ve siempre la IP
// del proxy y el limite se aplica de forma global (bypass + DoS a usuarios legitimos).
app.set('trust proxy', 1);

// Oculta la tecnologia del servidor.
app.disable('x-powered-by');

app.use(helmet({
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-site' }
}));

// La app Android no envia Origin. Solo se permiten origenes explicitos
// (CORS_ORIGINS separado por comas); por defecto, ninguno.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
    .split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);            // clientes nativos
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Origen no permitido'), false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600
}));

app.use(express.json({ limit: '1mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
app.use(limiter);

// Auth: limite estricto por IP. El bloqueo por cuenta se hace en routes/auth.js.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Demasiados intentos. Intentalo mas tarde.' }
});

app.use('/auth', authLimiter, authRoutes);
app.use('/v1/clientes', auth, clientesRoutes);
app.use('/v1/registros', auth, registrosRoutes);
app.use('/v1/registros/:registroId/documentos', auth, ownsRegistro, documentosRoutes);
app.use('/v1/dias-guardia', auth, diasGuardiaRoutes);
app.use('/v1/guardias', auth, guardiasRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err && err.message === 'Origen no permitido') {
        return res.status(403).json({ error: 'Origen no permitido' });
    }
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
        return res.status(413).json({ error: 'Payload demasiado grande' });
    }
    if (err && err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'JSON invalido' });
    }
    // Nunca exponer stacktrace ni mensaje interno al cliente.
    console.error('[error]', err && (err.code || err.name || 'unknown'));
    res.status(500).json({ error: 'Error interno' });
});

module.exports = app;
