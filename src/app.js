const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const auth       = require('./middleware/auth');

const authRoutes       = require('./routes/auth');
const registrosRoutes  = require('./routes/registros');
const guardiasRoutes   = require('./routes/guardias');
const documentosRoutes = require('./routes/documentos');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
app.use(limiter);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

app.use('/auth', authLimiter, authRoutes);
app.use('/v1/registros', auth, registrosRoutes);
app.use('/v1/registros/:registroId/documentos', auth, documentosRoutes);
app.use('/v1/guardias', auth, guardiasRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
});

module.exports = app;
