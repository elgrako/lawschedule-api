-- Misma clave de idempotencia que 003 para la creacion de clientes desde la app.
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS client_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_clientes_client_ref ON clientes (usuario_id, client_ref) WHERE client_ref IS NOT NULL;
