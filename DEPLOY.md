# Deploy LawSchedule API

## Opción A — Local / desarrollo (más rápido)

### Requisitos
- Node.js 20+
- PostgreSQL 14+ corriendo localmente

```bash
cd backend
cp .env.example .env
# Editar .env con tu DATABASE_URL y JWT_SECRET

npm install
npm run db:migrate
npm run dev
```

API en `http://localhost:3000`

---

## Opción B — Docker Compose (recomendado para VPS)

```bash
cd backend
cp .env.example .env
# Solo necesitas cambiar JWT_SECRET en .env

docker compose up -d
docker compose exec api node src/db/migrate.js
```

API en `http://TU_IP:3000`

---

## Opción C — Railway (deploy en la nube, gratis hasta $5/mes)

1. Crear cuenta en https://railway.app
2. New Project → Deploy from GitHub repo
3. Seleccionar la carpeta `backend/` como root
4. Railway detecta automáticamente Node.js
5. Add Plugin → PostgreSQL (Railway crea la DB y pone DATABASE_URL automáticamente)
6. Variables de entorno a configurar en Railway:
   - `JWT_SECRET` → string largo aleatorio (ej: genera con `openssl rand -hex 32`)
   - `NODE_ENV` → `production`
   - `JWT_EXPIRES_IN` → `30d`
   - `DATABASE_URL` → Railway lo pone automático al añadir PostgreSQL
7. Deploy → Railway da una URL pública tipo `https://lawschedule-api-xxx.railway.app`
8. Ejecutar migración una vez: Settings → Run Command → `node src/db/migrate.js`

---

## Opción D — Render (alternativa gratuita)

1. https://render.com → New Web Service → conectar repo
2. Root Directory: `backend`
3. Build Command: `npm install`
4. Start Command: `node src/server.js`
5. Add Environment Variables igual que Railway
6. New PostgreSQL → copiar Internal Database URL como `DATABASE_URL`
7. Shell → `node src/db/migrate.js`

---

## Configurar Android para apuntar al servidor

### Desarrollo local (emulador)
En `gradle.properties`:
```
# PIN_HOST=10.0.2.2:3000
```
En `build.gradle`, cambiar la línea de `API_HOST`:
```groovy
def pinHostDebug = project.findProperty("PIN_HOST") ?: "10.0.2.2:3000"
```
Y en `NetworkModule.java` cambiar `https://` por `http://` en debug:
```java
private static final String BASE_URL = BuildConfig.DEBUG
    ? "http://" + BuildConfig.API_HOST + "/"
    : "https://" + BuildConfig.API_HOST + "/";
```

### Producción (Railway/Render)
En `gradle.properties`:
```
PIN_HOST=tu-app.railway.app
```
Certificate pinning: obtener el pin SHA-256 con:
```bash
openssl s_client -connect tu-app.railway.app:443 2>/dev/null | \
  openssl x509 -pubkey -noout | \
  openssl pkey -pubin -outform der | \
  openssl dgst -sha256 -binary | base64
```
Luego en `gradle.properties`:
```
PIN_SHA256=sha256/BASE64_RESULTADO=
```

---

## Verificar que funciona

```bash
# Health check
curl http://localhost:3000/health

# Register
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","nombre":"Test","password":"password123"}'

# Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123"}'
```
