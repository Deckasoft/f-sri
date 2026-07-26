# 🌐 Ejemplos de cURL para F Sri

Esta guía contiene ejemplos prácticos de cURL para interactuar con la API de
F Sri: alta de un tenant desde el backoffice, onboarding del cliente, y uso de
la API de facturación (`/api/v1/*`).

> No existe ningún endpoint de auto-registro. Los antiguos `POST /register`,
> `POST /auth` y `GET /status` fueron **retirados por completo** — cualquier
> ejemplo que los use en una versión anterior de este documento ya no es
> válido. Ver [SECURITY.md](SECURITY.md) para el modelo de autenticación
> completo.

## 🔧 Configuración Base

```bash
# URL base del servidor (ajusta según tu configuración)
export BASE_URL="http://localhost:3000"

# Para usar en producción
# export BASE_URL="https://facturacion.tudominio.com"
```

## 1️⃣ Administración (backoffice) — login y alta de un tenant

Requiere un usuario administrador ya creado (`npm run create-admin`, ver
`DEPLOYMENT.md`/README.md).

### 1. Login de administrador

```bash
curl -s -X POST "$BASE_URL/admin/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@tuempresa.com",
    "password": "una-contraseña-segura"
  }'
```

**Respuesta esperada:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "64f8a1b2c3d4e5f6a7b8c9d0",
    "email": "admin@tuempresa.com",
    "role": "admin"
  }
}
```

El token expira en 4 días.

```bash
# Guardar el token de administrador para los siguientes requests
export ADMIN_TOKEN=$(curl -s -X POST "$BASE_URL/admin/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@tuempresa.com", "password": "una-contraseña-segura"}' \
  | jq -r '.token')
```

### 2. Crear un tenant (empresa emisora)

```bash
curl -s -X POST "$BASE_URL/admin/api/tenants" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "ruc": "1234567890001",
    "razon_social": "Empresa Ejemplo S.A.",
    "nombre_comercial": "Empresa Ejemplo",
    "direccion": "Av. Principal 123, Ciudad",
    "telefono": "0999999999",
    "codigo_establecimiento": "001",
    "punto_emision": "001",
    "tipo_ambiente": 1,
    "tipo_emision": 1
  }' | jq
```

```bash
# Guardar el id del tenant recién creado
export TENANT_ID=$(curl -s -X POST "$BASE_URL/admin/api/tenants" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"ruc": "1234567890001", "razon_social": "Empresa Ejemplo S.A.", "nombre_comercial": "Empresa Ejemplo"}' \
  | jq -r '._id')
```

### 3. Generar una invitación de onboarding

```bash
curl -s -X POST "$BASE_URL/admin/api/tenants/$TENANT_ID/invites" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

**Respuesta esperada** (el token sólo se muestra aquí, una única vez):
```json
{
  "id": "64f8a1b2c3d4e5f6a7b8c9e0",
  "token": "inv_...",
  "onboarding_url": "http://localhost:3000/onboarding?token=inv_...",
  "expires_at": "2026-08-01T00:00:00.000Z"
}
```

```bash
export INVITE_TOKEN=$(curl -s -X POST "$BASE_URL/admin/api/tenants/$TENANT_ID/invites" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.token')
```

### 4. (Alternativa) Crear una API key directamente desde el backoffice

Si no necesitas el flujo de onboarding (por ejemplo, para pruebas internas),
un administrador puede emitir una API key para un tenant directamente:

```bash
curl -s -X POST "$BASE_URL/admin/api/tenants/$TENANT_ID/api-keys" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name": "Integración interna"}' | jq
```

**Respuesta esperada** (el `token` se muestra una única vez):
```json
{
  "id": "64f8a1b2c3d4e5f6a7b8c9f0",
  "name": "Integración interna",
  "prefix": "sk_live_a1b2",
  "token": "sk_live_...",
  "created_at": "2026-07-24T10:30:00.000Z"
}
```

## 🗂️ Gestión de Tenants, API Keys e Invitaciones (backoffice, JWT admin)

Operaciones adicionales de administración sobre un tenant ya creado — listar,
consultar, actualizar su perfil y, sobre todo, **activarlo/desactivarlo**.

### Listar todos los tenants

```bash
curl -s -X GET "$BASE_URL/admin/api/tenants" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

Devuelve el array completo de documentos `IssuingCompany` (sin proyección —
`certificate`/`certificate_password` siguen ocultos porque el esquema los
marca `select: false` por defecto, no por nada específico de esta ruta).

### Obtener un tenant por id

```bash
curl -s -X GET "$BASE_URL/admin/api/tenants/$TENANT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

### Actualizar el perfil de un tenant

Mismos campos que el autoservicio (`razon_social`, `nombre_comercial`,
`direccion`, `tipo_ambiente`, etc. — ver `src/routes/admin/tenant.ts`), pero
aquí puede hacerlo un admin sobre **cualquier** tenant por `:id`. `ruc`,
`active`, `certificate`/`certificate_password` y `onboarded_at` no forman
parte de este esquema.

```bash
curl -s -X PUT "$BASE_URL/admin/api/tenants/$TENANT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"telefono": "0999888777", "email": "facturacion@empresaejemplo.com"}' | jq
```

### ⚠️ Activar / desactivar un tenant (`active`)

Este es el interruptor operativamente más importante del backoffice: cuando
`active` pasa a `false`, **todas** las API keys de ese tenant dejan de
funcionar de inmediato en `/api/v1/*` (`apiKeyAuth` rechaza la petición si la
empresa asociada tiene `active: false` — ver `SECURITY.md`), sin tener que
revocar cada clave una por una. Es el mecanismo real para "suspender" o
"dar de baja" un cliente.

```bash
curl -s -X PUT "$BASE_URL/admin/api/tenants/$TENANT_ID/active" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"active": false}' | jq
```

**Respuesta esperada** (documento `IssuingCompany` actualizado):
```json
{
  "_id": "64f8a1b2c3d4e5f6a7b8c9d1",
  "ruc": "1234567890001",
  "razon_social": "Empresa Ejemplo S.A.",
  "active": false,
  "...": "..."
}
```

Reactivar es la misma llamada con `{"active": true}`.

### Listar las API keys de un tenant

```bash
curl -s -X GET "$BASE_URL/admin/api/tenants/$TENANT_ID/api-keys" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

**Respuesta esperada** (nunca incluye `key_hash`, solo el `prefix` para
mostrar en UI — el token completo ya no es recuperable después de su
creación):
```json
[
  {
    "_id": "64f8a1b2c3d4e5f6a7b8c9f0",
    "empresa_emisora_id": "64f8a1b2c3d4e5f6a7b8c9d1",
    "name": "Integración interna",
    "prefix": "sk_live_a1b2",
    "revoked_at": null,
    "last_used_at": "2026-07-20T09:00:00.000Z",
    "createdAt": "2026-07-01T10:30:00.000Z"
  }
]
```

### Revocar una API key

Soft-delete: marca `revoked_at`, no borra el documento. Una clave revocada
es rechazada de inmediato por `apiKeyAuth` en `/api/v1/*`.

```bash
curl -s -X DELETE "$BASE_URL/admin/api/tenants/$TENANT_ID/api-keys/64f8a1b2c3d4e5f6a7b8c9f0" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

### Listar las invitaciones de un tenant

```bash
curl -s -X GET "$BASE_URL/admin/api/tenants/$TENANT_ID/invites" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

**Respuesta esperada** (incluye `token_hash` — el hash SHA-256, nunca el
token en texto plano, que solo se muestra una vez al crear la invitación):
```json
[
  {
    "_id": "64f8a1b2c3d4e5f6a7b8c9e0",
    "empresa_emisora_id": "64f8a1b2c3d4e5f6a7b8c9d1",
    "token_hash": "a1b2c3...",
    "expires_at": "2026-08-01T00:00:00.000Z",
    "used_at": null,
    "createdAt": "2026-07-24T10:00:00.000Z"
  }
]
```

### Eliminar una invitación (revocar antes de que se use)

```bash
curl -s -X DELETE "$BASE_URL/admin/api/tenants/$TENANT_ID/invites/64f8a1b2c3d4e5f6a7b8c9e0" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

## 📊 Métricas de Uso / Metering (backoffice, JWT admin)

Conteo de comprobantes emitidos por tenant, agrupado por tipo de documento y
estado SRI — la base para facturar a cada tenant según su consumo. Ambos
endpoints aceptan `from`/`to` opcionales (fechas ISO) para acotar el rango;
sin ellos, cuentan todo el histórico.

### Uso de un tenant específico

```bash
curl -s -X GET "$BASE_URL/admin/api/tenants/$TENANT_ID/usage" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# Acotado a un rango de fechas
curl -s -X GET "$BASE_URL/admin/api/tenants/$TENANT_ID/usage?from=2026-07-01&to=2026-07-31" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

**Respuesta esperada** (una fila por combinación `document_type`/`sri_estado`):
```json
[
  { "document_type": "invoice", "sri_estado": "RECIBIDA", "count": 128 },
  { "document_type": "invoice", "sri_estado": "DEVUELTA", "count": 3 },
  { "document_type": "credit_note", "sri_estado": "RECIBIDA", "count": 12 }
]
```

### Resumen global (todos los tenants, para comparar consumo)

```bash
curl -s -X GET "$BASE_URL/admin/api/usage/summary" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

**Respuesta esperada** (ordenado de mayor a menor consumo):
```json
[
  { "empresa_emisora_id": "64f8a1b2c3d4e5f6a7b8c9d1", "total": 143 },
  { "empresa_emisora_id": "64f8a1b2c3d4e5f6a7b8c9d9", "total": 27 }
]
```

## 2️⃣ Onboarding (público) — el cliente redime su invitación

Estos dos endpoints son públicos: no requieren API key ni JWT (el propio
token de invitación es la credencial, y es de un solo uso).

### 5. Previsualizar una invitación

```bash
curl -s "$BASE_URL/onboarding/api/invite/$INVITE_TOKEN" | jq
```

**Respuesta esperada:**
```json
{
  "valid": true,
  "company": {
    "razon_social": "Empresa Ejemplo S.A.",
    "nombre_comercial": "Empresa Ejemplo",
    "ruc": "*********0001"
  }
}
```

Si el token no existe, ya fue usado, o expiró:
```json
{ "valid": false, "reason": "expired" }
```

### 6. Completar el onboarding (sube el certificado .p12 y recibe la primera API key)

```bash
curl -s -X POST "$BASE_URL/onboarding/api/complete" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "'"$INVITE_TOKEN"'",
    "certificate": "LS0tLS1CRUdJTi...",
    "certificate_password": "password_del_certificado",
    "contact_email": "contacto@empresaejemplo.com"
  }'
```

**Respuesta esperada** (el `api_key` se muestra una única vez — este es el
único momento en que el cliente lo ve):
```json
{
  "message": "Onboarding complete",
  "api_key": "sk_live_...",
  "company": {
    "id": "64f8a1b2c3d4e5f6a7b8c9d1",
    "razon_social": "Empresa Ejemplo S.A.",
    "nombre_comercial": "Empresa Ejemplo",
    "ruc": "1234567890001"
  }
}
```

Si la contraseña del certificado es incorrecta, no se consume la invitación:
```json
{ "message": "Invalid P12 certificate: ..." }
```

```bash
# Guardar la API key del tenant para los siguientes requests
export API_KEY=$(curl -s -X POST "$BASE_URL/onboarding/api/complete" \
  -H "Content-Type: application/json" \
  -d '{"token": "'"$INVITE_TOKEN"'", "certificate": "...", "certificate_password": "..."}' \
  | jq -r '.api_key')
```

## 3️⃣ Facturación Electrónica (`/api/v1/*`, requiere `X-API-Key`)

Todos los endpoints bajo `/api/v1` requieren la API key del tenant, enviada
como header `X-API-Key` (o `Authorization: Bearer sk_live_...`). Cada request
queda automáticamente acotado al tenant dueño de la clave.

### 7. Crear Factura Completa

```bash
curl -X POST "$BASE_URL/api/v1/invoice/complete" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "factura": {
      "infoTributaria": {
        "ruc": "1234567890001"
      },
      "infoFactura": {
        "fechaEmision": "17/12/2024",
        "tipoIdentificacionComprador": "05",
        "identificacionComprador": "0923456789",
        "razonSocialComprador": "Cliente Ejemplo",
        "totalSinImpuestos": "100.00",
        "importeTotal": "112.00"
      },
      "detalles": [
        {
          "detalle": {
            "codigoPrincipal": "P001",
            "descripcion": "Producto de Ejemplo",
            "cantidad": "1.00",
            "precioUnitario": "100.00",
            "precioTotalSinImpuesto": "100.00",
            "impuestos": [
              {
                "impuesto": {
                  "codigo": "2",
                  "codigoPorcentaje": "4",
                  "tarifa": "15.00",
                  "baseImponible": "100.00",
                  "valor": "15.00"
                }
              }
            ]
          }
        }
      ]
    }
  }'
```

> ⚠️ El `ruc` en `infoTributaria` debe coincidir con el RUC de la empresa
> emisora del tenant autenticado por `$API_KEY` — si no coincide, la
> respuesta es `400`. Un tenant nunca puede emitir un comprobante a nombre de
> otro.

### 8. Listar Facturas (del tenant autenticado)

```bash
curl -X GET "$BASE_URL/api/v1/invoice" \
  -H "X-API-Key: $API_KEY"
```

### 9. Obtener Factura por ID

```bash
curl -X GET "$BASE_URL/api/v1/invoice/64f8a1b2c3d4e5f6a7b8c9d2" \
  -H "X-API-Key: $API_KEY"
```

## 📄 Gestión de PDFs

Los PDFs se generan **automáticamente** cuando el SRI confirma la recepción
(`sri_estado: "RECIBIDA"`) y se almacenan en el proveedor configurado (S3
recomendado en producción — ver `.env.example`). No requiere intervención
manual.

### 10. Listar PDFs

```bash
curl -X GET "$BASE_URL/api/v1/invoice-pdf" \
  -H "X-API-Key: $API_KEY"
```

### 11. Obtener PDF por ID de Factura

```bash
curl -X GET "$BASE_URL/api/v1/invoice-pdf/invoice/64f8a1b2c3d4e5f6a7b8c9d2" \
  -H "X-API-Key: $API_KEY"
```

### 12. Obtener PDF por Clave de Acceso

```bash
curl -X GET "$BASE_URL/api/v1/invoice-pdf/access-key/1712202401123456789000110010010000000011234567890" \
  -H "X-API-Key: $API_KEY"
```

### 13. Descargar PDF (redirige 302 a la URL del proveedor configurado)

```bash
curl -L -X GET "$BASE_URL/api/v1/invoice-pdf/download/1712202401123456789000110010010000000011234567890" \
  -H "X-API-Key: $API_KEY" \
  -o "factura.pdf"
```

### 14. Solicitar Regeneración del PDF

```bash
curl -X POST "$BASE_URL/api/v1/invoice-pdf/regenerate/64f8a1b2c3d4e5f6a7b8c9d2" \
  -H "X-API-Key: $API_KEY"
```

**Respuesta esperada:**
```json
{ "message": "PDF regeneration requested", "facturaId": "64f8a1b2c3d4e5f6a7b8c9d2" }
```

### 15. Solicitar el Envío del PDF por Email

```bash
curl -X POST "$BASE_URL/api/v1/invoice-pdf/send-email/1712202401123456789000110010010000000011234567890" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"email_destinatario": "cliente@correo.com"}'
```

### 16. Consultar el Estado de Envío del Email

```bash
curl -X GET "$BASE_URL/api/v1/invoice-pdf/email-status/1712202401123456789000110010010000000011234567890" \
  -H "X-API-Key: $API_KEY"
```

### 17. Reintentar el Envío del Email

```bash
curl -X POST "$BASE_URL/api/v1/invoice-pdf/retry-email/1712202401123456789000110010010000000011234567890" \
  -H "X-API-Key: $API_KEY"
```

## 🏢 Gestión de la Empresa Emisora (autoservicio del tenant)

`GET`/`PUT /api/v1/issuing-company` siempre resuelven **la propia empresa del
tenant autenticado** — no hay `:id`, no hay forma de listar ni consultar la
empresa de otro tenant, y el certificado nunca se incluye en la respuesta.

### 18. Consultar mi empresa

```bash
curl -X GET "$BASE_URL/api/v1/issuing-company" \
  -H "X-API-Key: $API_KEY"
```

### 19. Actualizar el perfil de mi empresa

Solo se aceptan los campos del whitelist (`razon_social`, `nombre_comercial`,
`direccion`, `telefono`, `email`, etc. — ver `src/routes/issuingCompany.ts`).
`ruc`, `active`, `certificate` y `certificate_password` se ignoran
silenciosamente si se envían aquí.

```bash
curl -X PUT "$BASE_URL/api/v1/issuing-company" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "telefono": "0999888777",
    "email": "facturacion@empresa.com"
  }'
```

### 20. Reemplazar el certificado digital

Se verifica que el `.p12` abra con la contraseña dada antes de cifrarlo y
guardarlo; si la verificación falla, no se guarda nada.

```bash
curl -X PUT "$BASE_URL/api/v1/issuing-company/certificate" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "certificate": "LS0tLS1CRUdJTi...",
    "certificate_password": "nueva_password_certificado"
  }'
```

## 👥 Gestión de Clientes (del tenant autenticado)

### 21. Crear Cliente

```bash
curl -X POST "$BASE_URL/api/v1/client" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "tipo_identificacion_id": "64f8a1b2c3d4e5f6a7b8c9d3",
    "identificacion": "0923456789",
    "razon_social": "Cliente Ejemplo",
    "email": "cliente@email.com",
    "telefono": "0999123456",
    "direccion": "Av. Secundaria 456, Ciudad"
  }'
```

### 22. Listar Clientes

```bash
curl -X GET "$BASE_URL/api/v1/client" \
  -H "X-API-Key: $API_KEY"
```

### 23. Actualizar Cliente

```bash
curl -X PUT "$BASE_URL/api/v1/client/64f8a1b2c3d4e5f6a7b8c9d4" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "telefono": "0999654321",
    "email": "nuevo@cliente.com"
  }'
```

## 📦 Gestión de Productos (del tenant autenticado)

### 24. Crear Producto

```bash
curl -X POST "$BASE_URL/api/v1/product" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "codigo": "P001",
    "descripcion": "Producto de Ejemplo",
    "precio_unitario": 850.00
  }'
```

### 25. Listar Productos

```bash
curl -X GET "$BASE_URL/api/v1/product" \
  -H "X-API-Key: $API_KEY"
```

### 26. Actualizar Producto

```bash
curl -X PUT "$BASE_URL/api/v1/product/64f8a1b2c3d4e5f6a7b8c9d5" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "precio_unitario": 900.00,
    "descripcion": "Producto de Ejemplo Actualizado"
  }'
```

## 🆔 Tipos de Identificación (catálogo global, solo lectura)

`identification-type` es un catálogo global compartido por todos los
tenants — no hay endpoints de creación/edición/borrado en `/api/v1`
(fueron retirados: mantener ese catálogo es una tarea de administración, no
de un tenant individual).

### 27. Listar Tipos de Identificación

```bash
curl -X GET "$BASE_URL/api/v1/identification-type" \
  -H "X-API-Key: $API_KEY"
```

**Respuesta esperada:**
```json
[
  { "_id": "64f8a1b2c3d4e5f6a7b8c9d3", "codigo": "04", "descripcion": "RUC" },
  { "_id": "64f8a1b2c3d4e5f6a7b8c9d4", "codigo": "05", "descripcion": "CEDULA" },
  { "_id": "64f8a1b2c3d4e5f6a7b8c9d5", "codigo": "06", "descripcion": "PASAPORTE" },
  { "_id": "64f8a1b2c3d4e5f6a7b8c9d6", "codigo": "07", "descripcion": "CONSUMIDOR FINAL" },
  { "_id": "64f8a1b2c3d4e5f6a7b8c9d7", "codigo": "08", "descripcion": "IDENTIFICACION DEL EXTERIOR" }
]
```

### 28. Obtener un Tipo de Identificación por ID

```bash
curl -X GET "$BASE_URL/api/v1/identification-type/64f8a1b2c3d4e5f6a7b8c9d3" \
  -H "X-API-Key: $API_KEY"
```

## 🔍 Ejemplos de Respuestas de Error

### API key ausente (401)

```bash
curl -X GET "$BASE_URL/api/v1/invoice"
```

**Respuesta:**
```json
{ "message": "API key requerida" }
```

### API key inválida o revocada (401)

```bash
curl -X GET "$BASE_URL/api/v1/invoice" \
  -H "X-API-Key: sk_live_no_existe"
```

**Respuesta:**
```json
{ "message": "API key inválida" }
```

### RUC del comprador/tenant no coincide con el tenant autenticado (400)

```bash
curl -X POST "$BASE_URL/api/v1/invoice/complete" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"factura": {"infoTributaria": {"ruc": "0000000000001"}, ...}}'
```

**Respuesta:**
```json
{ "success": false, "message": "El RUC del comprobante no coincide con la empresa autenticada" }
```

### Login de administrador con credenciales inválidas (401)

```bash
curl -X POST "$BASE_URL/admin/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@tuempresa.com", "password": "incorrecta"}'
```

**Respuesta:**
```json
{ "message": "Credenciales inválidas" }
```

## 🧪 Scripts de Testing

### Script Completo de Prueba (admin → onboarding → factura)

```bash
#!/bin/bash
set -e

BASE_URL="http://localhost:3000"

echo "🔑 Login de administrador..."
ADMIN_TOKEN=$(curl -s -X POST "$BASE_URL/admin/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@tuempresa.com", "password": "una-contraseña-segura"}' \
  | jq -r '.token')

echo "🏢 Creando tenant..."
TENANT_ID=$(curl -s -X POST "$BASE_URL/admin/api/tenants" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"ruc": "1234567890001", "razon_social": "Empresa Test S.A.", "nombre_comercial": "Empresa Test"}' \
  | jq -r '._id')
echo "  Tenant: $TENANT_ID"

echo "✉️  Generando invitación de onboarding..."
INVITE_TOKEN=$(curl -s -X POST "$BASE_URL/admin/api/tenants/$TENANT_ID/invites" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.token')

echo "📝 Completando onboarding (certificado de prueba)..."
API_KEY=$(curl -s -X POST "$BASE_URL/onboarding/api/complete" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$INVITE_TOKEN\", \"certificate\": \"dGVzdF9jZXJ0aWZpY2F0ZQ==\", \"certificate_password\": \"test\"}" \
  | jq -r '.api_key')
echo "🔑 API key obtenida: ${API_KEY:0:16}..."

echo "🧾 Creando factura completa..."
FACTURA_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/invoice/complete" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "factura": {
      "infoTributaria": {"ruc": "1234567890001"},
      "infoFactura": {
        "fechaEmision": "17/12/2024",
        "tipoIdentificacionComprador": "05",
        "identificacionComprador": "0923456789",
        "razonSocialComprador": "Cliente Test",
        "totalSinImpuestos": "100.00",
        "importeTotal": "112.00"
      },
      "detalles": [{
        "detalle": {
          "codigoPrincipal": "P001",
          "descripcion": "Producto Test",
          "cantidad": "1.00",
          "precioUnitario": "100.00",
          "precioTotalSinImpuesto": "100.00",
          "impuestos": [{"impuesto": {"codigo": "2", "codigoPorcentaje": "4", "tarifa": "15.00", "baseImponible": "100.00", "valor": "15.00"}}]
        }
      }]
    }
  }')

FACTURA_ID=$(echo "$FACTURA_RESPONSE" | jq -r '._id // empty')
echo "📋 ID de factura creada: $FACTURA_ID"

echo "⏳ Esperando procesamiento de factura (30 segundos)..."
sleep 30

echo "🔍 Verificando estado de la factura..."
curl -s -X GET "$BASE_URL/api/v1/invoice/$FACTURA_ID" -H "X-API-Key: $API_KEY" | jq

echo "📄 Buscando PDF generado..."
curl -s -X GET "$BASE_URL/api/v1/invoice-pdf/invoice/$FACTURA_ID" -H "X-API-Key: $API_KEY" | jq

echo "✅ Pruebas completadas!"
```

### Guardar y Ejecutar

```bash
chmod +x test_api.sh
./test_api.sh
```

## 📚 Documentación Adicional

- **Swagger UI**: `http://localhost:3000/docs` (documenta `/api/v1/*`)
- **OpenAPI JSON**: `http://localhost:3000/swagger.json`
- **Postman/Insomnia**: importa estos cURLs directamente

---

**💡 Tip**: Usa `jq` para formatear las respuestas JSON de manera legible.

```bash
# Instalar jq en Ubuntu/Debian
sudo apt install jq

# Instalar jq en macOS
brew install jq
```
