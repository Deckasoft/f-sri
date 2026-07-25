# Despliegue en producción (Hostinger VPS + MongoDB Atlas)

Esta guía cubre el despliegue de la imagen Docker de F Sri en un VPS (probado
con Hostinger) usando MongoDB Atlas como base de datos. No es una reescritura
del README (eso es tarea de una fase posterior) — es el procedimiento
operativo puntual para esta fase de containerización.

## 1. Arquitectura

- **`Dockerfile`** (raíz del repo): build multi-stage que compila el backend
  (`src/` → `dist/`) y el SPA de administración (`admin/` → `admin/dist/`),
  e instala en la imagen final las librerías de Debian que Chromium necesita
  para que Puppeteer pueda generar los RIDE en PDF. Corre como el usuario
  `node` (no root).
- **`compose.prod.yml`**: dos servicios —
  - `api`: la imagen de arriba, sin publicar puertos al host directamente.
  - `caddy`: termina TLS (HTTPS automático vía Let's Encrypt) y hace reverse
    proxy a `api:3000`. Publica 80/443.
  - **No hay contenedor de Mongo.** La base de datos es MongoDB Atlas; el VPS
    se conecta a través de `MONGO_URI` en `.env.production` (ver sección 3).
- **`compose.yml`** (existente) sigue siendo solo para desarrollo local
  (mongo + mongo-express con credenciales de prueba). No usarlo en el VPS.

## 2. Prerrequisitos

- Un VPS con Docker Engine + el plugin `docker compose` instalados.
- Un dominio (o subdominio) apuntando con un registro DNS A/AAAA a la IP del
  VPS — Caddy necesita esto para emitir el certificado TLS automáticamente.
- Un clúster de MongoDB Atlas (o self-hosted Mongo accesible) y su
  connection string.
- Un bucket S3 privado en AWS (ver sección 3) y un usuario IAM dedicado con
  permisos `PutObject`/`GetObject`/`DeleteObject` acotados a ese bucket.
- Una API key de [Resend](https://resend.com) y un remitente verificado, si
  se quiere el envío de emails con la factura adjunta.

## 3. Variables de entorno (`.env.production`)

Crear `.env.production` en el VPS, en el mismo directorio que
`compose.prod.yml`. **Nunca** se hornea en la imagen ni se commitea al repo
(está en `.gitignore`).

```bash
touch .env.production
chmod 600 .env.production
```

Variables **requeridas** — `src/config/env.config.ts` hace fail-fast al
arrancar si falta alguna o tiene formato inválido:

| Variable | Notas |
| --- | --- |
| `MONGO_URI` | Connection string de Atlas. Ver "Allowlisting" abajo. |
| `JWT_SECRET` | Cadena aleatoria larga. `openssl rand -hex 64`. |
| `ENCRYPTION_KEY` | **Exactamente 64 caracteres hexadecimales** (32 bytes). `openssl rand -hex 32`. |
| `PUBLIC_URL` | URL pública real del servidor (p. ej. `https://facturacion.tudominio.com`), **no** `localhost` — se usa para construir los enlaces de onboarding en las invitaciones. |

Variables adicionales necesarias para el funcionamiento completo (no
fail-fast, pero requeridas para que ciertas features funcionen):

| Variable | Notas |
| --- | --- |
| `PORT` | `3000` (coincide con `EXPOSE`/`compose.prod.yml`). |
| `NODE_ENV` | `production`. |
| `ALLOWED_ORIGINS` | Orígenes permitidos por CORS, separados por comas. |
| `CORS_DISABLED` | `false` en producción. |
| `PDF_STORAGE_PROVIDER` | `s3` (default recomendado — ver `.env.example`; mantiene el contenedor sin estado). |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Credenciales del usuario IAM dedicado al bucket. |
| `AWS_REGION` | Región del bucket S3. |
| `S3_BUCKET` | Bucket privado (las descargas se sirven vía URLs presignadas). |
| `RESEND_API_KEY` | Si se omite, el envío de emails se deshabilita de forma controlada (no rompe el arranque). |
| `EMAIL_FROM` | Remitente verificado en Resend. |
| `SRI_ENVIRONMENT` | `1` = pruebas, `2` = producción. |
| `SRI_RECEPCION_URL_PRUEBAS` / `SRI_RECEPCION_URL_PRODUCCION` | Endpoints WSDL de recepción del SRI. |
| `SRI_AUTORIZACION_URL_PRUEBAS` / `SRI_AUTORIZACION_URL_PRODUCCION` | Endpoints WSDL de autorización del SRI. |
| `IVA` / `CODIGO_PORCENTAJE` | Tarifa de IVA vigente y su código según la tabla 17 del SRI. |

Usa `.env.example` como plantilla (documenta cada variable en español con más
detalle).

**Nota sobre S3:** las variables de S3 se validan de forma perezosa dentro
del constructor del proveedor de storage, no al arrancar el proceso. Un S3
mal configurado no impide que el contenedor arranque ni que `/health`
responda — falla recién en el primer intento de subir un PDF. Verifica las
credenciales con una factura de prueba después de desplegar, no asumas que
"arrancó bien" implica que S3 está bien configurado.

### Allowlisting de la IP del VPS en Atlas

MongoDB Atlas bloquea por defecto todo acceso que no esté en su lista de IPs
permitidas (Network Access). Antes de que `MONGO_URI` funcione desde el VPS:

1. Obtén la IP pública saliente del VPS (`curl ifconfig.me` desde el VPS).
2. En el dashboard de Atlas → Network Access → Add IP Address → agrega esa
   IP (o el rango del proveedor, si el VPS no tiene IP fija).
3. Espera a que el cambio se propague (unos segundos) antes de arrancar el
   contenedor.

## 4. Primer despliegue

```bash
# En el VPS, en el directorio donde viven compose.prod.yml, Caddyfile y
# .env.production:

# 1. Editar el Caddyfile: reemplazar "yourdomain.com" por el dominio real.

# 2. (Opcional) fijar la imagen exacta a desplegar
export GHCR_IMAGE=ghcr.io/<owner>/<repo>:latest

# 3. Traer la imagen y levantar los servicios
docker compose -f compose.prod.yml pull
docker compose -f compose.prod.yml up -d

# 4. Verificar
docker compose -f compose.prod.yml logs -f api
curl -I https://tudominio.com/health
```

La imagen se construye y publica automáticamente en GHCR
(`ghcr.io/<owner>/<repo>`) por el job `docker` de
`.github/workflows/ci.yml` en cada push a `main`. Ese job **solo publica la
imagen**; no despliega. Ver la sección 6 para el flujo de actualización.

## 5. Crear el primer usuario admin

`npm run create-admin` es un script ts-node (no compilado a `dist/`); la
imagen mantiene `ts-node`/`typescript` y `scripts/` disponibles justo para
esto. Ejecutarlo dentro del contenedor ya corriendo:

```bash
docker compose -f compose.prod.yml exec api \
  npm run create-admin -- admin@tuempresa.com "una-contraseña-segura"
```

(o vía `ADMIN_EMAIL`/`ADMIN_PASSWORD` como variables de entorno del `exec`,
ver `scripts/create-admin.ts`). Con eso puedes hacer login en
`POST /admin/api/auth/login` y acceder al backoffice en `/admin`.

## 6. Actualizar a una nueva versión

```bash
docker compose -f compose.prod.yml pull
docker compose -f compose.prod.yml up -d
```

Esto descarga la imagen `:latest` más reciente publicada por CI y recrea el
contenedor `api` (Caddy no necesita reiniciarse salvo que cambie el
Caddyfile). El despliegue es manual/por SSH a propósito — ver
`task-7-report.md` para la justificación de no automatizarlo vía Actions.

## 7. Notas operativas

- El contenedor es **sin estado**: no hay volumen para PDFs (S3 los guarda).
  No agregues uno salvo que vuelvas a `PDF_STORAGE_PROVIDER=local`
  deliberadamente (solo pensado como fallback de desarrollo).
- `os.tmpdir()` (usado para escribir temporalmente certificados `.p12` y
  archivos intermedios de PDF) es `/tmp` dentro del contenedor, escribible
  por el usuario `node` por defecto en la imagen base — no requiere
  configuración adicional.
- Los logs van a stdout/stderr (`docker compose logs`); no hay rotación de
  archivos de log que gestionar dentro del contenedor.
