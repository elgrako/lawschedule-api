# LawSchedule API

Backend REST para la app Android LawSchedule. Node.js + Express + PostgreSQL.

## Deploy en Render (5 minutos)

### 1. Subir a GitHub

```bash
cd backend
git init
git add .
git commit -m "Initial commit"
# Crear repo en github.com/new (nombre: lawschedule-api, privado)
git remote add origin https://github.com/TU_USUARIO/lawschedule-api.git
git push -u origin main
```

### 2. Deploy en Render

1. Ir a [render.com](https://render.com) → **New** → **Blueprint**
2. Conectar tu repo GitHub
3. Render detecta `render.yaml` y crea automáticamente:
   - Web Service (Node.js)
   - PostgreSQL database
   - `JWT_SECRET` generado automáticamente
4. Click **Apply** → esperar ~3 min
5. Tu API queda en: `https://lawschedule-api.onrender.com`

> Las migraciones corren automáticamente al arrancar. No hay que ejecutar nada manualmente.

### 3. Configurar Android

En `gradle.properties` del proyecto Android:
```properties
PIN_HOST=lawschedule-api.onrender.com
```

En `NetworkModule.java`, la base URL ya usa `BuildConfig.API_HOST` dinámicamente.

---

## Evitar sleep en Render (free tier)

Render free duerme tras 15 min de inactividad. Usar **UptimeRobot**:

1. Ir a [uptimerobot.com](https://uptimerobot.com) → crear cuenta gratis
2. **Add New Monitor**:
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `LawSchedule API`
   - URL: `https://lawschedule-api.onrender.com/health`
   - Monitoring Interval: **5 minutes**
3. Guardar → UptimeRobot pinga `/health` cada 5 min, Render nunca duerme

---

## Desarrollo local

```bash
cp .env.example .env
# Editar .env con tu DATABASE_URL local y JWT_SECRET

npm install
npm run dev
```

## Endpoints

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
