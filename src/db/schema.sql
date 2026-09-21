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

-- v2 (dias_guardia): antes 1 fila de `guardias` = 1 dia + 1 asistido, con juzgado/juez
-- duplicados por cada asistido del mismo dia. Ahora el dia vive aparte y `guardias` solo
-- referencia. Las columnas viejas de dia en `guardias` (dia_actuacion, por_juzgado,
-- juzgado, telefono_juzgado, agente_judicial, juez) se DEJAN en la tabla sin usar
-- (nunca se borran) para que un rollback del deploy siga funcionando contra el codigo
-- anterior sin que le falten columnas.
CREATE TABLE IF NOT EXISTS dias_guardia (
    id                  BIGSERIAL PRIMARY KEY,
    usuario_id          BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    dia_actuacion       DATE,
    por_juzgado         BOOLEAN DEFAULT FALSE,
    juzgado             VARCHAR(200),
    telefono_juzgado    VARCHAR(30),
    agente_judicial     VARCHAR(200),
    juez                VARCHAR(200),
    observaciones       TEXT,
    created_at          BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
    updated_at          BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

CREATE TABLE IF NOT EXISTS guardias (
    id                      BIGSERIAL PRIMARY KEY,
    dia_guardia_id          BIGINT REFERENCES dias_guardia(id) ON DELETE CASCADE,
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

-- Instalaciones existentes: la CREATE TABLE de arriba no las toca (IF NOT EXISTS), asi
-- que la columna nueva se agrega aqui explicitamente. Seguro de re-ejecutar en cada boot.
ALTER TABLE guardias ADD COLUMN IF NOT EXISTS dia_guardia_id BIGINT REFERENCES dias_guardia(id) ON DELETE CASCADE;

-- Backfill: crea un dia_guardia por cada (usuario_id, dia_actuacion) distinto entre las
-- guardias que aun no tienen dia_guardia_id, y las vincula. Idempotente: solo mira filas
-- con dia_guardia_id IS NULL, asi que en el siguiente boot ya no hay nada que hacer.
INSERT INTO dias_guardia (usuario_id, dia_actuacion, por_juzgado, juzgado, telefono_juzgado, agente_judicial, juez)
SELECT DISTINCT ON (usuario_id, dia_actuacion)
       usuario_id, dia_actuacion, por_juzgado, juzgado, telefono_juzgado, agente_judicial, juez
FROM guardias
WHERE dia_guardia_id IS NULL AND dia_actuacion IS NOT NULL
ORDER BY usuario_id, dia_actuacion, id DESC;

UPDATE guardias g
SET dia_guardia_id = dg.id
FROM dias_guardia dg
WHERE g.dia_guardia_id IS NULL
  AND g.dia_actuacion IS NOT NULL
  AND g.usuario_id = dg.usuario_id
  AND g.dia_actuacion = dg.dia_actuacion;

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

CREATE TABLE IF NOT EXISTS clientes (
    id          BIGSERIAL PRIMARY KEY,
    usuario_id  BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    nombre      VARCHAR(200) NOT NULL,
    dni_nif     VARCHAR(20),
    email       VARCHAR(120),
    telefono    VARCHAR(30),
    direccion   VARCHAR(300),
    notas       TEXT,
    created_at  BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
    updated_at  BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);

-- ON DELETE SET NULL (no CASCADE): borrar un cliente no debe destruir sus
-- expedientes, solo desvincularlos — son el historial legal del caso.
ALTER TABLE registros ADD COLUMN IF NOT EXISTS cliente_id BIGINT REFERENCES clientes(id) ON DELETE SET NULL;

-- Revocacion de JWT: se incluye en el payload al firmar y se compara contra
-- este valor en cada request autenticado. Incrementarlo invalida de inmediato
-- todos los tokens ya emitidos para ese usuario (p.ej. al cambiar contrasena).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_registros_usuario ON registros(usuario_id);
CREATE INDEX IF NOT EXISTS idx_clientes_usuario ON clientes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_registros_cliente ON registros(cliente_id);
CREATE INDEX IF NOT EXISTS idx_dias_guardia_usuario ON dias_guardia(usuario_id);
CREATE INDEX IF NOT EXISTS idx_guardias_usuario ON guardias(usuario_id);
CREATE INDEX IF NOT EXISTS idx_guardias_dia_guardia ON guardias(dia_guardia_id);
CREATE INDEX IF NOT EXISTS idx_situaciones_guardia ON situaciones_guardia(guardia_id);
CREATE INDEX IF NOT EXISTS idx_apelaciones_guardia ON apelaciones_guardia(guardia_id);
CREATE INDEX IF NOT EXISTS idx_recursos_guardia ON recursos_guardia(guardia_id);
CREATE INDEX IF NOT EXISTS idx_recursos_extra_guardia ON recursos_extra_ordinarios(guardia_id);
CREATE INDEX IF NOT EXISTS idx_documentos_registro ON documentos_registro(registro_id);
