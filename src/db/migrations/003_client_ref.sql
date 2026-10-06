-- Clave de idempotencia de la creacion desde la app. Si un POST llega al
-- servidor pero la respuesta se pierde (timeout), la app reintenta: con esta
-- clave el reintento devuelve la fila ya creada en vez de duplicarla.
ALTER TABLE registros    ADD COLUMN IF NOT EXISTS client_ref TEXT;
ALTER TABLE dias_guardia ADD COLUMN IF NOT EXISTS client_ref TEXT;
ALTER TABLE guardias     ADD COLUMN IF NOT EXISTS client_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_registros_client_ref    ON registros    (usuario_id, client_ref) WHERE client_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_dias_guardia_client_ref ON dias_guardia (usuario_id, client_ref) WHERE client_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_guardias_client_ref     ON guardias     (usuario_id, client_ref) WHERE client_ref IS NOT NULL;
