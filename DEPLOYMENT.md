# Despliegue en producción (Hostinger VPS + MongoDB Atlas)

Esta guía cubre el despliegue de la imagen Docker de F Sri en un VPS (probado
con Hostinger) usando MongoDB Atlas como base de datos. No es una reescritura
del README (eso es tarea de una fase posterior) — es el procedimiento
operativo puntual para esta fase de containerización.

> ## ⚠️ ESTE RELEASE ASUME UNA BASE DE DATOS VACÍA/NUEVA
>
> Todo este documento asume que `MONGO_URI` apunta a una base de datos **sin
> datos previos** (un clúster de Atlas recién creado, o cualquier Mongo
> vacío). El plan de este release es un arranque limpio ("clean start"), sin
> datos en producción de antes. **Si alguna vez se despliega esta imagen
> sobre una base de datos que YA contiene `clients`, `products`, o
> comprobantes emitidos de una versión anterior de este sistema, hace falta
> una migración de backfill ANTES de arrancar el contenedor** — no hacerlo
> rompe el arranque o la emisión de comprobantes de forma silenciosa/difícil
> de diagnosticar. Concretamente:
>
> 1. **`Client` y `Product` ahora requieren `empresa_emisora_id`** (campo
>    obligatorio) más un índice único compuesto por tenant
>    (`{ empresa_emisora_id, identificacion }` / `{ empresa_emisora_id,
>    codigo }` — ver `src/models/Client.ts` / `src/models/Product.ts`).
>    Documentos legacy sin ese campo:
>    - Fallan la validación de Mongoose en el primer `.save()` que los toque.
>    - Rompen la construcción del índice único con un rechazo `E11000` que
>      Mongoose solo *loguea* (vía `autoIndex`), sin detener el arranque —
>      así que el contenedor parece "arrancar bien" mientras el índice queda
>      a medio construir o simplemente no se construye.
>    - **La migración debe**: backfillear `empresa_emisora_id` en cada
>      `Client`/`Product` legacy con el tenant correcto (deducido de qué
>      esquema/base/cuenta pertenecía cada documento en el sistema
>      pre-multi-tenant), y solo entonces dejar que Mongoose construya el
>      índice único compuesto — verificando antes que no haya colisiones
>      reales dentro de un mismo tenant recién asignado (dos clientes con la
>      misma `identificacion` bajo el mismo `empresa_emisora_id` haría fallar
>      el backfill, no el arranque, así que hay que revisar duplicados
>      primero).
> 2. **El contador atómico de secuenciales es una colección nueva que
>    arranca en `current: 0`** (`src/models/Sequence.ts` /
>    `src/utils/sequence.utils.ts`), reemplazando la lógica anterior que
>    derivaba el secuencial del máximo existente en los documentos ya
>    emitidos. Desplegado sobre una base con comprobantes ya emitidos, la
>    primera emisión post-deploy de cada (tenant, tipo de documento)
>    reutilizará `000000001` — **el SRI la rechaza como duplicada**, un corte
>    de la operación de negocio principal (emitir comprobantes), no solo un
>    error de arranque.
>    - **La migración debe**: para cada `(empresa_emisora_id,
>      document_type)` que ya tenga documentos emitidos, crear/actualizar su
>      documento `Sequence` con `current` igual al secuencial más alto ya
>      emitido para ese tenant y tipo (no `0`), ANTES de que el contenedor
>      nuevo emita el primer comprobante.
>
> Si este release se despliega tal cual sobre una base de datos con datos
> preexistentes SIN antes escribir y correr esa migración, es un despliegue
> roto: no es una advertencia teórica, es la ruta esperada de fallo. Esta
> guía no incluye el script de migración — escríbelo y córrelo (una sola vez,
> antes del primer `docker compose up`) si este release llega a desplegarse
> sobre una base que no está vacía.

## 1. Arquitectura

- **`Dockerfile`** (raíz del repo): build multi-stage que compila el backend
  (`src/` → `dist/`, `scripts/create-admin.ts` → `dist-scripts/`) y el SPA de
  administración (`admin/` → `admin/dist/`), e instala en la imagen final las
  librerías de Debian que Chromium necesita para que Puppeteer pueda generar
  los RIDE en PDF. Corre como el usuario `node` (no root). La imagen final
  **no** incluye `src/`, `scripts/`, ningún `tsconfig*.json` ni
  devDependencies (`ts-node`/`typescript`) — solo `dist/`, `dist-scripts/`,
  `admin/dist/` y `node_modules` de producción. Este contenedor maneja
  certificados `.p12` de firma de clientes y emite comprobantes tributarios
  con validez legal, así que minimizar lo que queda alcanzable ahí dentro
  importa más que en una app típica.

  > ⚠️ **Build local en Mac Apple Silicon (arm64):** pasa
  > `--platform linux/amd64` al construir la imagen localmente:
  > ```bash
  > docker build --platform linux/amd64 -t f-sri .
  > ```
  > Google no publica un build oficial de Chrome para Linux ARM64, así que el
  > descargador de Puppeteer termina bajando un binario x64 incluso en un
  > host/imagen arm64. Un `docker build .` sin `--platform` en un Mac de
  > Apple Silicon **construye la imagen sin errores**, pero Chromium no
  > puede arrancar en tiempo de ejecución (`rosetta error: failed to open
  > elf at /lib64/ld-linux-x86-64.so.2`) — generación de PDF rota en
  > silencio. Un VPS real (Hostinger) es x86_64, así que esto **no afecta el
  > despliegue en producción** (la imagen la construye GitHub Actions en un
  > runner x86_64, y CI no necesita el flag) — es solo una trampa para
  > cualquiera que construya la imagen a mano en una Mac M1/M2/M3/M4.
- **`compose.prod.yml`**: cinco servicios —
  - `api`: la imagen de arriba, sin publicar puertos al host directamente.
  - `worker`: la misma imagen, corriendo `node dist/worker.js` — los 4
    workers de BullMQ (autorización, PDF, email, reconciliador).
  - `redis`: job store de BullMQ, sin volumen (todo es re-derivable desde
    MongoDB vía el reconciliador).
  - `caddy`: termina TLS (HTTPS automático vía Let's Encrypt) y hace reverse
    proxy a `api:3000`. Publica 80/443.
  - `watchtower`: vigila el tag `:prod` en GHCR y recrea `api`/`worker`
    cuando cambia — ver sección 6, es la mitad "recibir" del flujo de
    despliegue.
  - **No hay contenedor de Mongo.** La base de datos es MongoDB Atlas; el VPS
    se conecta a través de `MONGO_URI` en `.env.production` (ver sección 3).

### 1.2 Por qué VPS y no Lambda/Fargate

Se evaluó desplegar todo en AWS Lambda para bajar costos: **descartado**. El
flujo de emisión responde al cliente HTTP y *después* firma/envía al SRI en
segundo plano (`trackBackgroundWork` en cada `*.service.ts` de documentos),
lo cual Lambda mata al congelar el entorno de ejecución apenas retorna la
respuesta; los 4 workers de BullMQ son consumidores bloqueantes de Redis de
larga duración (`src/queue/connection.ts`); y el reconciliador es un job
repetible de BullMQ. Adaptar esto a Lambda es una reescritura (SQS,
encolar-antes-de-responder, EventBridge) para ahorrar, en el mejor caso,
unos pocos dólares al mes. ECS Fargate también se descartó, pero por costo:
con pricing verificado de AWS (us-east-1, x86 — la imagen está fijada a
amd64 por Chromium/Puppeteer), API + worker + Redis + ALB salen en
~US$47-50/mes on-demand (~US$28-32 con Spot), 3-5x el presupuesto de VPS
(~US$5-12/mes).
- **`compose.yml`** (existente) sigue siendo solo para desarrollo local
  (mongo + mongo-express con credenciales de prueba). No usarlo en el VPS.
- **`compose.local.yml`** levanta el stack completo en tu máquina —
  **construyendo** la imagen desde el `Dockerfile` local, con su propio
  mongo — para probar el artefacto real antes de desplegarlo. Ver sección
  1.1. Tampoco usarlo en el VPS.

### 1.1 Probar el stack completo localmente (antes de desplegar)

`npm run dev` ejecuta el código sobre Node en el host, así que no ejerce
nada de lo que aporta la imagen: usuario no-root, `create-admin`
precompilado, la SPA de admin empaquetada, ni las dependencias de Chromium.
`compose.local.yml` sí, porque construye y corre esa misma imagen:

```bash
cp .env.example .env.local     # editar: ver las 4 variables de la sección 3
docker compose -f compose.local.yml up -d --build

# Crear el primer admin DENTRO del contenedor (binario precompilado, sin ts-node)
docker compose -f compose.local.yml exec api \
  node dist-scripts/scripts/create-admin.js admin@example.test 'ChangeMe123!'

open http://localhost:3000/admin      # backoffice
open http://localhost:3000/docs       # Swagger

docker compose -f compose.local.yml down -v   # -v borra también los datos
```

En `.env.local`, `MONGO_URI` debe apuntar al servicio de compose, no a
localhost: `mongodb://root:example@mongo:27017/f-sri-local?authSource=admin`.
`PDF_STORAGE_PROVIDER=local` evita necesitar credenciales de AWS, y si se
deja `RESEND_API_KEY` sin definir el envío de emails se degrada
silenciosamente en vez de fallar. `.env.local` está en `.gitignore`.

El mongo de este stack se publica en el host en el **27018** (no en el 27017),
para poder inspeccionarlo con Compass/mongosh sin chocar con el mongo que ya
publica `compose.yml` en 27017 — los dos stacks conviven, no hace falta parar
ninguno. Cadena de conexión:

```
mongodb://root:example@localhost:27018/f-sri-local?authSource=admin
```

Se puede cambiar el puerto del host con `MONGO_HOST_PORT`. La API no usa ese
puerto: alcanza a mongo por la red de compose como `mongo:27017`.

Tampoco incluye Caddy: su HTTPS automático necesita un dominio público real,
así que en local se publica el puerto de la API directamente.

> ⚠️ **Apple Silicon / ARM**: el servicio `api` fija `platform: linux/amd64`
> a propósito. No quitarlo: una build nativa arm64 produce una imagen cuyo
> Chromium no arranca (no existe build oficial de Chrome-for-Testing para
> Linux ARM64), con lo que la generación de PDFs falla en runtime aunque
> todo lo demás parezca sano. Corre emulado, así que la primera build tarda
> varios minutos.

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
- `mongodb-database-tools` (para `mongodump`) y el `aws` CLI instalados en el
  VPS, si se va a correr `scripts/backup-mongo.sh` (ver sección 9).

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

> ⚠️ Antes de continuar: confirma que `MONGO_URI` apunta a una base de datos
> **vacía/nueva**. Si no lo es, ver la advertencia al comienzo de este
> documento — hace falta una migración de backfill primero.

La imagen se construye y publica automáticamente en GHCR por el job `docker`
de `.github/workflows/ci.yml` en cada push a `main`, en
**`ghcr.io/deckasoft/f-sri`** (el job calcula `ghcr.io/${{ github.repository
}}` en minúsculas — los paths de GHCR/Docker deben ser todo minúsculas — para
este repo, `github.com/Deckasoft/f-sri`, eso da `ghcr.io/deckasoft/f-sri`).
`compose.prod.yml` ya trae ese valor como default de `GHCR_IMAGE`, así que
normalmente **no** necesitas exportar la variable — solo hazlo si vas a
desplegar un fork o una imagen con otro nombre. Ese job **solo publica la
imagen**; no despliega. Ver la sección 6 para el flujo de actualización.

**Antes del primer `pull`: los paquetes de GHCR son privados por defecto.**
`docker compose pull` falla con un error de autenticación en el VPS a menos
que hagas una de estas dos cosas:

- **Opción A — login con un PAT (recomendado para mantener el paquete privado):**
  crea un GitHub Personal Access Token (classic) con el scope `read:packages`
  y, en el VPS **como root** (el servicio `watchtower` monta
  `/root/.docker/config.json` de solo lectura para reusar exactamente este
  login — si en cambio haces login como un usuario no-root, ajusta esa ruta
  en `compose.prod.yml`):
  ```bash
  echo "$GHCR_PAT" | docker login ghcr.io -u <tu-usuario-github> --password-stdin
  ```
  El login persiste en `~/.docker/config.json`; no hace falta repetirlo en
  cada despliegue salvo que rotes el token.
- **Opción B — hacer público el paquete:** en GitHub → el repo →
  Packages → `f-sri` → Package settings → Change visibility → Public. Con
  el paquete público, `docker compose pull` funciona sin login. Más simple,
  pero expone la imagen (no contiene secretos — `.env.production` nunca se
  hornea en ella — pero sí expone el código fuente compilado).

**Antes del primer `pull`: el tag `:prod` todavía no existe.** `api` y
`worker` usan `ghcr.io/deckasoft/f-sri:prod` por defecto (ver sección 6), y
ese tag solo se crea corriendo el workflow "Promote to production"
(`.github/workflows/promote.yml`) desde GitHub Actions — CI únicamente
publica `:latest` en cada push a `main`. Antes del primer despliegue, corre
ese workflow una vez (déjalo promover el `:latest` actual) para que exista
`:prod` antes de intentar el `pull` de abajo.

```bash
# En el VPS, en el directorio donde viven compose.prod.yml, Caddyfile y
# .env.production:

# 1. Editar el Caddyfile: reemplazar "yourdomain.com" por el dominio real.

# 2. (Solo si el login de GHCR no está hecho aún) autenticarse — ver arriba.

# 3. Traer la imagen y levantar los servicios
docker compose -f compose.prod.yml pull
docker compose -f compose.prod.yml up -d

# 4. Verificar
docker compose -f compose.prod.yml ps          # columna "STATUS" debe decir "healthy"
docker compose -f compose.prod.yml logs -f api
curl -I https://tudominio.com/health
```

## 5. Crear el primer usuario admin

> ⚠️ **Antes de esto (o justo después), sembrar el catálogo de tipos de
> identificación — es OBLIGATORIO, ver sección 5.1.** Sin ese paso no se
> puede crear ningún cliente ni emitir ningún comprobante.

`scripts/create-admin.ts` se precompila a `dist-scripts/scripts/create-admin.js`
durante el build de la imagen (ver `tsconfig.scripts.json`) — el contenedor
en producción no tiene `ts-node`/`typescript` ni el código fuente en `src/`
(ver sección 1), así que se ejecuta con `node` directo, no con
`npm run create-admin` (ese script sigue existiendo en `package.json` para
uso local en desarrollo, vía ts-node, pero no aplica dentro del contenedor):

```bash
docker compose -f compose.prod.yml exec api \
  node dist-scripts/scripts/create-admin.js admin@tuempresa.com "una-contraseña-segura"
```

(o vía `ADMIN_EMAIL`/`ADMIN_PASSWORD` como variables de entorno del `exec`,
p. ej. `docker compose -f compose.prod.yml exec -e ADMIN_EMAIL=... -e
ADMIN_PASSWORD=... api node dist-scripts/scripts/create-admin.js` — ver
`scripts/create-admin.ts` para la lógica). Con eso puedes hacer login en
`POST /admin/api/auth/login` y acceder al backoffice en `/admin`.

### 5.1 Sembrar el catálogo de tipos de identificación (OBLIGATORIO)

`identification-type` es un catálogo **global y de solo lectura**: sus rutas
de mutación se eliminaron a propósito, porque cualquier tenant autenticado
podía modificar entradas de las que dependen todos los demás para emitir. La
consecuencia es que **nada lo puebla solo**: en una base de datos nueva la
colección arranca vacía, y

- `Client.tipo_identificacion_id` es requerido y referencia este catálogo, y
- la emisión resuelve el tipo por código y falla con
  `Identification type not found` si no lo encuentra.

Es decir: sin este paso **no se puede crear ningún cliente ni emitir ningún
comprobante**. Correr una vez por despliegue nuevo (es idempotente, se puede
repetir sin duplicar):

```bash
docker compose -f compose.prod.yml exec api \
  node dist-scripts/scripts/seed-identification-types.js
```

En local, con `compose.local.yml`, es el mismo comando cambiando el archivo
de compose; y fuera de Docker, `npm run seed:identification-types`.

Siembra los cinco códigos que define el SRI en su ficha técnica —`04` RUC,
`05` CÉDULA, `06` PASAPORTE, `07` VENTA A CONSUMIDOR FINAL, `08`
IDENTIFICACIÓN DEL EXTERIOR—. No son configurables: el XML emitido debe usar
exactamente esos valores. Verificar con:

```bash
curl -H "X-API-Key: <una-api-key>" http://localhost:3000/api/v1/identification-type
```

## 6. Actualizar a una nueva versión

Desplegar ya **no** requiere entrar por SSH al VPS. `api`/`worker` en
`compose.prod.yml` usan el tag `ghcr.io/deckasoft/f-sri:prod`, y el servicio
`watchtower` (mismo compose) sondea GHCR cada 5 minutos y recrea esos dos
contenedores en cuanto el dígest de `:prod` cambia.

**El despliegue es correr el workflow "Promote to production"**
(`.github/workflows/promote.yml`) desde GitHub Actions (`workflow_dispatch`):
retagea la imagen `:latest` que CI ya construyó (o un `sha_tag` específico
si querés promover un commit puntual) a `:prod`, sin reconstruir nada. Ese
retag ES el despliegue — no hay paso adicional.

- **Rollback:** volvé a correr el mismo workflow, pero con el input
  `sha_tag` apuntando al SHA completo de un commit anterior cuyo `:latest`
  ya haya pasado CI (el tag es `sha-<sha completo>`, publicado por el job
  `docker` de `ci.yml` — buscalo en el historial de runs de ese workflow o
  con `git log`).
- **Por qué un gate manual y no despliegue automático en cada merge a
  `main`:** un merge a `main` solo actualiza `:latest`; production sigue en
  el `:prod` anterior hasta que alguien decide deliberadamente promoverlo.
  Este sistema emite comprobantes tributarios con validez legal — un mal
  merge no debe llegar solo a producción.

Fallback manual si Watchtower no está corriendo (o para forzar el pull sin
esperar el intervalo de sondeo), por SSH en el VPS:

```bash
docker compose -f compose.prod.yml pull
docker compose -f compose.prod.yml up -d
```

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
- **Límite de memoria (`mem_limit`)**: `compose.prod.yml` fija `mem_limit:
  768m` / `mem_reservation: 256m` en el servicio `api`. Puppeteer/Chromium
  (invocado por cada PDF, ver `src/utils/pdf.utils.ts`) consume memoria de
  forma notable; sin un techo, un ciclo de OOM combinado con `restart:
  always` puede generar presión de memoria a nivel de todo el VPS (afectando
  también a Caddy). Ajusta el valor según el plan contratado en Hostinger:
  observa el uso real con `docker stats` bajo carga normal antes de subir o
  bajar el límite, y deja margen para el propio Node.js + Chromium
  simultáneo si esperas PDFs concurrentes.

### Troubleshooting: "el contenedor está `Up` pero no responde"

Sospecha primero de MongoDB Atlas — es el fallo más común en un primer
despliegue (IP del VPS no allowlisteada todavía, ver sección 3):

1. `docker compose -f compose.prod.yml ps` — si la columna `STATUS` dice
   algo distinto de `healthy` (p. ej. `starting` que nunca pasa a `healthy`,
   o `unhealthy`), el healthcheck de `/health` está fallando.
2. `docker compose -f compose.prod.yml logs api` — busca
   `❌ Database connection error`. `src/index.ts` llama a `process.exit(1)`
   si la conexión inicial a Mongo falla, así que con `restart: always` el
   contenedor entra en un ciclo de reinicios en vez de quedar "vivo pero
   sordo" (nunca abre el puerto 3000, nunca responde nada, y desde afuera
   parece un problema de Caddy/TLS en vez de uno de base de datos).
3. Si ves ese error, confirma el allowlisting de la IP del VPS en Atlas
   (sección 3) y que `MONGO_URI` en `.env.production` es exactamente el que
   Atlas te dio (usuario/contraseña/nombre de base incluidos).
4. Si el healthcheck falla pero no hay error de Mongo en los logs, revisa
   `docker compose logs caddy` — puede ser un problema de DNS/TLS entre
   Caddy e Internet, no del contenedor `api` en sí.

## 8. Hardening del VPS

`scripts/harden-vps.sh` es un script idempotente (se puede correr más de una
vez sin romper nada) que cubre lo mínimo para no tener que estar
"cuidando" el servidor a mano:

```bash
sudo ./scripts/harden-vps.sh
```

Configura: actualizaciones de seguridad automáticas (`unattended-upgrades`,
con reinicio automático a las 4am si el kernel lo requiere), firewall `ufw`
(solo 22/80/443), `fail2ban` sobre sshd, SSH solo por clave (sin login de
root por contraseña), un swapfile de 2GB (los `mem_limit` combinados de
`api`+`worker`+`redis` rondan 1.8GB — el swap absorbe picos de Chromium sin
que el OOM killer entre en juego), rotación de logs del daemon de Docker
(`max-size: 10m, max-file: 3` — logs sin rotar es la causa más común de
disco lleno), y un cron semanal de `docker system prune`. Correlo una vez
después de aprovisionar el VPS, antes o después del primer despliegue
(sección 4) — el orden no importa.

## 9. Backups de MongoDB (y cómo restaurar)

**Atlas M0 (el tier gratuito) no incluye backups automáticos.** El único
backup de los datos de producción es el que arma este script — si falla en
silencio, no hay backup, así que el script pinguea una URL de healthcheck
(ver abajo) en cada corrida.

```bash
# En el VPS, cron diario (como el usuario que tiene el .env.production):
crontab -e
# agregar:
0 3 * * * /ruta/a/f-sri/scripts/backup-mongo.sh >> /var/log/f-sri-backup.log 2>&1
```

El script (`scripts/backup-mongo.sh`) lee `MONGO_URI`/`S3_BUCKET` de
`.env.production`, corre `mongodump --archive --gzip` contra Atlas, y sube
el resultado a `s3://$S3_BUCKET/backups/mongo/YYYY-MM-DD.archive.gz` (mismo
bucket que ya usás para los PDFs — separado por prefijo, no por bucket).
Requiere `mongodb-database-tools` y el `aws` CLI instalados en el VPS (ver
sección 2).

**Alertar si el backup falla:** creá un check gratuito en
[healthchecks.io](https://healthchecks.io) y seteá `BACKUP_PING_URL` en
`.env.production` con la URL que te da (p. ej.
`https://hc-ping.com/<uuid>`). El script pinguea esa URL al terminar OK, y
`<url>/fail` si `mongodump` o el `aws s3 cp` fallan — configurá el check
para que te avise por email si no recibe un ping "OK" dentro de, por
ejemplo, 26 horas.

**Configuración del bucket S3 (una vez):** habilitá versionado en el bucket
y una regla de lifecycle que expire objetos bajo `backups/mongo/` después de
~90 días, para no acumular backups indefinidamente.

### Restaurar (probalo ANTES de necesitarlo de verdad)

```bash
# Bajar el backup del día que se necesite:
aws s3 cp s3://$S3_BUCKET/backups/mongo/YYYY-MM-DD.archive.gz /tmp/restore.archive.gz

# Restaurar contra un cluster de prueba (NUNCA directo contra producción
# sin antes verificar que es el backup correcto):
mongorestore --uri="<MONGO_URI de un cluster/DB de scratch>" \
  --archive=/tmp/restore.archive.gz --gzip --drop
```

Hacé este drill una vez, contra un cluster Atlas descartable, y contá los
documentos restaurados contra lo esperado — un backup que nunca se restauró
no es un backup confirmado, es una esperanza.

## 10. Monitoreo de uptime

Configuración manual, una sola vez: dado de alta un check HTTPS gratuito en
[UptimeRobot](https://uptimerobot.com) (o similar) apuntando a
`https://tudominio.com/health`, con alerta por email si deja de responder
200. Es la señal externa de que Caddy/DNS/TLS siguen funcionando, complementa
(no reemplaza) el healthcheck interno de `docker compose ps`.
