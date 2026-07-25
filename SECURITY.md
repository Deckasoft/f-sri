# 🔒 Guía de Seguridad - F Sri

Este documento describe el modelo de seguridad **actual** de F Sri: una API
multi-tenant de facturación electrónica con un backoffice de administración.

> ⚠️ No existe ningún mecanismo de auto-registro público. Las versiones
> anteriores de este documento describían un sistema de registro público
> gateado por `MASTER_REGISTRATION_KEY`/`INVITATION_CODES`/`ALLOWED_RUCS`
> (endpoint `POST /register`) — ese sistema fue **retirado por completo**.
> Ningún endpoint público permite crear un usuario, una empresa o una API key
> sin pasar por un administrador.

## 🧭 Dos límites de autenticación independientes

El sistema separa completamente dos audiencias, cada una con su propio
mecanismo de autenticación:

| Superficie | Quién la usa | Autenticación | Middleware |
| --- | --- | --- | --- |
| `/api/v1/*` | Sistemas cliente (integración de facturación) | API key por tenant (`X-API-Key` o `Authorization: Bearer sk_live_...`) | `src/middleware/apiKeyAuth.ts` |
| `/admin/api/*` | Personal interno (backoffice) | JWT de administrador (`Authorization: Bearer ...`), rol `admin` | `src/middleware/adminAuth.ts` |
| `/onboarding/api/*` | Cliente redimiendo una invitación | Token de invitación de un solo uso (no es una sesión) | público, sin guard |

No hay un JWT único que desbloquee todo el sistema: un JWT de administrador
nunca sirve para llamar `/api/v1/*`, y una API key de tenant nunca sirve para
llamar `/admin/api/*`.

### API de facturación (`/api/v1/*`) — API key por tenant

- La clave tiene el formato `sk_live_<32 bytes aleatorios en base64url>`
  (`src/utils/apiKey.utils.ts`).
- Solo se persiste su **hash SHA-256** (`ApiKey.key_hash`, campo `unique`); el
  token en texto plano se muestra exactamente una vez, en el momento de su
  creación (respuesta de `POST /admin/api/tenants/:id/api-keys` o de
  `POST /onboarding/api/complete`), y nunca se vuelve a mostrar.
- Las claves son **revocables** (soft-delete: se marca `revoked_at`, no se
  borra el documento) y se rechazan si la empresa emisora asociada tiene
  `active: false` (ver `apiKeyAuth.ts`) — desactivar un tenant corta el acceso
  de todas sus claves de inmediato, sin tener que revocarlas una por una.
- Cada request queda acotado al tenant resuelto por la propia API key
  (`req.auth.companyId`), no por ningún campo del cuerpo de la petición: al
  emitir un comprobante, el RUC del `infoTributaria` del body debe coincidir
  con el RUC del tenant autenticado, o la petición se rechaza con 400. Ningún
  tenant puede leer, listar ni modificar los datos de otro (clientes,
  productos, comprobantes, certificado).

### API de administración (`/admin/api/*`) — JWT de administrador

- Login: `POST /admin/api/auth/login` con `{ email, password }` (contraseña
  verificada con bcrypt) devuelve un JWT firmado con `JWT_SECRET`, payload
  `{ userId, role }`, expiración de **4 días**.
- `adminAuth` (`src/middleware/adminAuth.ts`) exige que el JWT decodifique
  correctamente y que `role === 'admin'`; cualquier otro caso es 401/403.
- El **primer** usuario administrador se crea fuera de la API, con el script
  `npm run create-admin` (`scripts/create-admin.ts`) — no hay ningún endpoint
  para auto-registrarse como admin. En producción, dentro del contenedor
  Docker, se ejecuta la versión precompilada
  `dist-scripts/scripts/create-admin.js` (ver `DEPLOYMENT.md`).
- Desde el backoffice, un administrador da de alta tenants
  (`POST /admin/api/tenants`), genera y revoca sus API keys
  (`/admin/api/tenants/:id/api-keys`), y genera invitaciones de onboarding
  (`/admin/api/tenants/:id/invites`).

### Onboarding de un tenant nuevo — invitación de un solo uso

No hay auto-registro: el alta de un tenant siempre la inicia un
administrador.

1. El administrador crea el tenant (`POST /admin/api/tenants`) y genera una
   invitación (`POST /admin/api/tenants/:id/invites`).
2. La invitación es un token aleatorio (`inv_...`, `src/utils/invite.utils.ts`)
   del que solo se persiste su hash SHA-256 (`Invite.token_hash`); expira a
   los **7 días** y es de **un solo uso** (consumo atómico vía
   `findOneAndUpdate` sobre `used_at: null`, para que dos redenciones
   concurrentes del mismo token no puedan ambas tener éxito).
3. El cliente abre el enlace de onboarding (`GET /onboarding/api/invite/:token`
   solo confirma validez y muestra una vista previa con el RUC parcialmente
   enmascarado) y completa el alta con
   `POST /onboarding/api/complete`, subiendo su certificado `.p12` en base64
   y su contraseña.
4. El certificado se **verifica** (que efectivamente abra con la contraseña
   dada) **antes** de consumir la invitación — una contraseña incorrecta no
   quema el único token del tenant.
5. La respuesta incluye la **primera API key** del tenant, mostrada una única
   vez.

## 🔐 Certificados digitales (.p12) y otros secretos en reposo

- `IssuingCompany.certificate` y `IssuingCompany.certificate_password` se
  cifran con AES-256-CBC (`src/utils/encryption.utils.ts`, IV aleatorio por
  valor) antes de guardarse, usando `ENCRYPTION_KEY` (32 bytes / 64
  caracteres hexadecimales).
- Ambos campos tienen `select: false` en el esquema de Mongoose
  (`src/models/IssuingCompany.ts`): un `find()`/`findOne()` normal —
  incluyendo el propio `GET /api/v1/issuing-company` de autoservicio del
  tenant — **nunca** los incluye en la respuesta. Solo el código interno que
  necesita firmar un comprobante los recupera explícitamente
  (`.select('+certificate +certificate_password')`).
- El endpoint de autoservicio `PUT /api/v1/issuing-company/certificate`
  verifica que el `.p12` recibido efectivamente abra con la contraseña dada
  (materializándolo a un archivo temporal de corta vida) antes de cifrarlo y
  guardarlo; si la verificación falla, no se guarda nada.
- Las claves de API (`ApiKey.key_hash`) y los tokens de invitación
  (`Invite.token_hash`) se guardan como hash SHA-256, no en texto plano ni
  cifrados de forma reversible — no hay ninguna operación legítima que
  necesite recuperar el valor original, solo compararlo.

## 🛡️ Otras medidas

- **Helmet**: cabeceras de seguridad HTTP en todas las respuestas (CSP
  deshabilitado deliberadamente porque `/docs` sirve Swagger UI desde un CDN
  externo — ver el comentario en `src/index.ts`).
- **Rate limiting** (`express-rate-limit`, `src/config/rateLimit.config.ts`):
  - `tenantLimiter` en todo `/api/v1/*`: 1000 peticiones / 15 min **por
    tenant** (clave = `req.auth.companyId`, resuelto por `apiKeyAuth`, que
    corre antes que el limiter — ver `src/index.ts`). Deliberadamente no se
    acota por IP: detrás del reverse proxy Caddy (`Caddyfile`,
    `compose.prod.yml`) todo el tráfico llega desde la misma dirección
    interna, así que una clave por IP metería a todos los tenants de la
    plataforma en el mismo balde.
  - `adminLoginLimiter`, por IP, solo en `POST /admin/api/auth/login`: 10
    peticiones / 15 min.
  - `onboardingLimiter`, por IP, solo en `/onboarding/api/*`: 20 peticiones /
    15 min. Es un balde separado de `adminLoginLimiter` a propósito: una
    ráfaga de tráfico de onboarding de tenants no debe poder bloquear el
    login de los operadores, ni viceversa.
  - `app.set('trust proxy', 1)` (`src/index.ts`/`src/testApp.ts`) le dice a
    Express que confíe en el primer salto (Caddy) para resolver `req.ip` a
    partir de `X-Forwarded-For` — necesario para que `adminLoginLimiter` y
    `onboardingLimiter` (ambos por IP) vean la IP real del cliente y no la
    del proxy. Se usa `1`, no `true`: `true` habilitaría confiar en toda la
    cadena de `X-Forwarded-For` (spoofeable por el propio cliente) y
    `express-rate-limit` rechaza arrancar con esa configuración
    (`ERR_ERL_PERMISSIVE_TRUST_PROXY`).
- **CORS**: configurable vía `ALLOWED_ORIGINS` (lista separada por comas) y
  `CORS_DISABLED` (ver `src/config/cors.config.ts`); nunca deshabilitar CORS
  en producción.
- **Validación de entorno al arrancar (fail-fast)**: `src/config/env.config.ts`
  detiene el proceso si `JWT_SECRET`, `ENCRYPTION_KEY` (64 hex), `MONGO_URI` o
  `PUBLIC_URL` faltan o tienen formato inválido, en lugar de arrancar en un
  estado a medio configurar (p. ej. firmando JWTs con un secreto vacío).
- **Aislamiento entre tenants**: cubierto en detalle en `README.md` — cada
  ruta de `/api/v1` está acotada al tenant resuelto por la API key
  autenticada, nunca por un identificador que llegue en el cuerpo o la URL de
  la petición.

## ⚙️ Variables de entorno relevantes para seguridad

Ver `.env.example` para el detalle completo, en español, de cada variable.
Las relevantes a este documento:

```env
# Obligatorias (fail-fast al arrancar)
JWT_SECRET=...              # Firma los JWT de administrador
ENCRYPTION_KEY=...          # 64 hex chars (32 bytes) — cifra certificado/contraseña de certificado
MONGO_URI=...
PUBLIC_URL=...              # Usada para construir los enlaces de onboarding

# CORS
ALLOWED_ORIGINS=https://tu-frontend.com,https://tu-backoffice.com
CORS_DISABLED=false         # Nunca 'true' en producción
```

## 🚨 Respuestas de error típicas

### API key ausente o inválida (`/api/v1/*`)

```json
{ "message": "API key requerida" }
```

```json
{ "message": "API key inválida" }
```

(Se devuelve el mismo mensaje genérico tanto si la clave no existe como si
está revocada o pertenece a una empresa desactivada, para no filtrar cuál de
esas condiciones aplica.)

### JWT de administrador ausente o inválido (`/admin/api/*`)

```json
{ "message": "Missing token" }
```

```json
{ "message": "Invalid token" }
```

```json
{ "message": "Forbidden" }
```

(este último cuando el JWT es válido pero el `role` no es `admin`)

### Invitación de onboarding inválida, expirada o ya usada

```json
{ "message": "Invalid, expired, or already used invite token" }
```

## 🐛 Reportar una vulnerabilidad

Si encuentras un problema de seguridad:

1. **No** lo reportes en un issue público.
2. Revisa primero si corresponde a este repositorio (fork privado) o al
   proyecto original [XaviMontero/f-sri](https://github.com/XaviMontero/f-sri).
3. Contacta directamente al equipo que mantiene este fork, con el detalle
   necesario para reproducirlo (endpoint, payload, comportamiento esperado
   vs. observado).

---

**⚠️ Importante**: nunca compartas API keys, tokens de invitación, JWTs de
administrador ni el valor de `ENCRYPTION_KEY`/`JWT_SECRET` públicamente.
