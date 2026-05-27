-- LawSchedule DB schema

CREATE TABLE IF NOT EXISTS usuarios (
    id          BIGSERIAL PRIMARY KEY,
    email       VARCHAR(120) UNIQUE NOT NULL,
    nombre      VARCHAR(200) NOT NULL,
    password_hash TEXT NOT NULL,
    created_at  BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

CREATE TABLE IF NOT EXISTS registros (
    id              BIGSERIAL PRIMARY KEY,
    nombre          VARCHAR(200),
    dni             VARCHAR(20),
    n_expediente    VARCHAR(100),
    euros           DOUBLE PRECISION DEFAULT 0,
    email           VARCHAR(120),
    telefono        VARCHAR(30),
    presentado      BOOLEAN DEFAULT FALSE,
    validado        BOOLEAN DEFAULT FALSE,
    pagado          BOOLEAN DEFAULT FALSE,
    n_talon         VARCHAR(100),
    comentarios     TEXT,
    estado          VARCHAR(50) DEFAULT 'PENDIENTE',
    usuario_id      BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    created_at      BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
    updated_at      BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

CREATE TABLE IF NOT EXISTS guardias (
    id                      BIGSERIAL PRIMARY KEY,
    nombre_asistido         VARCHAR(200),
    dia_actuacion           DATE,
    por_juzgado             BOOLEAN DEFAULT FALSE,
    cobrado                 BOOLEAN DEFAULT FALSE,
    juzgado                 VARCHAR(200),
    telefono_juzgado        VARCHAR(30),
    agente_judicial         VARCHAR(200),
    juez                    VARCHAR(200),
    observaciones_asistido  TEXT,
    usuario_id              BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    created_at              BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
    updated_at              BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

CREATE TABLE IF NOT EXISTS situaciones_guardia (
    id          BIGSERIAL PRIMARY KEY,
    guardia_id  BIGINT NOT NULL REFERENCES guardias(id) ON DELETE CASCADE,
    comentarios TEXT,
    n_talon     VARCHAR(100),
    euros       DOUBLE PRECISION DEFAULT 0,
    presentado  BOOLEAN DEFAULT FALSE,
    validado    BOOLEAN DEFAULT FALSE,
    pagado      BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS apelaciones_guardia (
    id              BIGSERIAL PRIMARY KEY,
    guardia_id      BIGINT NOT NULL REFERENCES guardias(id) ON DELETE CASCADE,
    n_expediente    VARCHAR(100),
    admitido        BOOLEAN DEFAULT FALSE,
    presentado      BOOLEAN DEFAULT FALSE,
    sentencia       BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS recursos_guardia (
    id              BIGSERIAL PRIMARY KEY,
    guardia_id      BIGINT NOT NULL REFERENCES guardias(id) ON DELETE CASCADE,
    n_expediente    VARCHAR(100),
    resuelto        BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS recursos_extra_ordinarios (
    id              BIGSERIAL PRIMARY KEY,
    guardia_id      BIGINT NOT NULL REFERENCES guardias(id) ON DELETE CASCADE,
    n_expediente    VARCHAR(100),
    admitido        BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS documentos_registro (
    id              BIGSERIAL PRIMARY KEY,
    registro_id     BIGINT NOT NULL REFERENCES registros(id) ON DELETE CASCADE,
    nombre_archivo  VARCHAR(255) NOT NULL,
    tipo_mime       VARCHAR(100),
    fecha_agregado  BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
    url_remota      TEXT
);

CREATE INDEX IF NOT EXISTS idx_registros_usuario ON registros(usuario_id);
CREATE INDEX IF NOT EXISTS idx_guardias_usuario ON guardias(usuario_id);
CREATE INDEX IF NOT EXISTS idx_situaciones_guardia ON situaciones_guardia(guardia_id);
CREATE INDEX IF NOT EXISTS idx_apelaciones_guardia ON apelaciones_guardia(guardia_id);
CREATE INDEX IF NOT EXISTS idx_recursos_guardia ON recursos_guardia(guardia_id);
CREATE INDEX IF NOT EXISTS idx_recursos_extra_guardia ON recursos_extra_ordinarios(guardia_id);
CREATE INDEX IF NOT EXISTS idx_documentos_registro ON documentos_registro(registro_id);
