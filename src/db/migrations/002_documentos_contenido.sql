-- Los documentos adjuntos dejan de guardarse en el disco de Render (efimero,
-- se borra en cada redeploy) y pasan a persistirse aqui mismo, junto al
-- resto de datos.
ALTER TABLE documentos_registro ADD COLUMN IF NOT EXISTS contenido BYTEA;
ALTER TABLE documentos_guardia  ADD COLUMN IF NOT EXISTS contenido BYTEA;
