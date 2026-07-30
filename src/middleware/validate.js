/**
 * Saneado de entrada. Postgres ya esta protegido de inyeccion por queries
 * parametrizadas; esto limita tamano y tipo para evitar abuso de recursos,
 * datos corruptos y payloads inesperados.
 */
const LIMITS = {
    nombre: 200, dni: 20, nExpediente: 60, email: 120, telefono: 20,
    nTalon: 60, comentarios: 5000, estado: 30, juzgado: 200,
    telefonoJuzgado: 20, agenteJudicial: 200, juez: 200,
    nombreAsistido: 200, observacionesAsistido: 5000, observaciones: 5000
};

const ESTADOS = ['PENDIENTE', 'EN_CURSO', 'POR_COMPLETAR', 'CON_DEFECTOS', 'TERMINADO'];

// Caracteres de control: incluye NUL, que Postgres rechaza en columnas TEXT.
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

function str(value, max) {
    if (typeof value !== 'string') return null;
    const t = value.trim();
    if (!t) return null;
    return t.replace(CONTROL_CHARS, '').slice(0, max);
}

function bool(v) { return v === true || v === 'true'; }

function num(v, opts) {
    const min = opts && opts.min !== undefined ? opts.min : 0;
    const max = opts && opts.max !== undefined ? opts.max : 1e9;
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.min(Math.max(n, min), max);
}

function estado(v) { return ESTADOS.includes(v) ? v : 'PENDIENTE'; }

function id(v) {
    return /^\d+$/.test(String(v)) && Number(v) > 0 && Number.isSafeInteger(Number(v))
        ? Number(v) : null;
}

module.exports = { LIMITS, ESTADOS, str, bool, num, estado, id };
