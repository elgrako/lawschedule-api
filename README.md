# LawSchedule API

Backend REST de **LawSchedule**, una app para que abogados del turno de oficio gestionen sus guardias, expedientes y documentación asociada. Construido con Node.js, Express y PostgreSQL.

## Funcionalidades

- Registro e inicio de sesión con JWT.
- Gestión de guardias: alta, edición, borrado y consulta filtrada por usuario.
- Seguimiento del estado de cada guardia (situación, apelaciones, recursos y recursos extraordinarios).
- Gestión de registros/expedientes, incluyendo subida y descarga de documentos (`multipart/form-data`).
- Endpoint de salud (`/health`) para monitorización externa.

## Tecnologías

- Node.js + Express.
- PostgreSQL como base de datos.
- `jsonwebtoken` + `bcrypt` para autenticación.
- `helmet` y `express-rate-limit` para cabeceras de seguridad y límite de peticiones (más estricto en `/auth`).
- `multer` para la subida de ficheros.
- Docker y `docker-compose` para desarrollo y despliegue local.

## Endpoints principales

```
POST   /auth/register
POST   /auth/login

GET    /v1/registros?user={id}
POST   /v1/registros
PUT    /v1/registros/:id
DELETE /v1/registros/:id
GET    /v1/registros/:id/documentos
POST   /v1/registros/:id/documentos        (multipart/form-data, campo: file)
GET    /v1/registros/:id/documentos/:docId/file
DELETE /v1/registros/:id/documentos/:docId

GET    /v1/guardias?user={id}
POST   /v1/guardias
PUT    /v1/guardias/:id
DELETE /v1/guardias/:id
GET/POST/PUT/DELETE /v1/guardias/:id/situacion
GET/POST/PUT/DELETE /v1/guardias/:id/apelaciones
GET/POST/PUT/DELETE /v1/guardias/:id/recurso
GET/POST/PUT/DELETE /v1/guardias/:id/recurso_extra

GET    /health
```

Todas las rutas salvo `/auth/*` y `/health` requieren cabecera `Authorization: Bearer <token>`.

## Desarrollo local

```bash
cp .env.example .env
# Completar DATABASE_URL y JWT_SECRET en .env

npm install
npm run dev
```

O con Docker:

```bash
docker compose up
```

## Despliegue

Incluye `render.yaml` para desplegar en [Render](https://render.com) como Blueprint (crea automáticamente el servicio web, la base de datos PostgreSQL y el `JWT_SECRET`). Las migraciones (`src/db/migrate.js`) se ejecutan automáticamente al arrancar. Más detalle en `DEPLOY.md`.

## Estructura

```
src/
├── app.js              # Configuración de Express (middlewares, rutas)
├── server.js            # Arranque del servidor
├── db/                   # Conexión, esquema y migraciones
├── middleware/auth.js    # Verificación de JWT
└── routes/               # auth, registros, guardias, documentos
```
