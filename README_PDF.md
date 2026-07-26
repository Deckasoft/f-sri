# Sistema de Generación de PDFs para Facturas Electrónicas

> ⚠️ **Nota (vigente)**: este documento es una nota de diseño histórica.
> Dos cosas cambiaron desde que se escribió: (1) el envío de emails, descrito
> más abajo como "EN PREPARACIÓN" con Nodemailer, **ya está implementado**,
> usando **Resend** (no Nodemailer) — ver `src/utils/email.utils.ts` y
> `RESEND_API_KEY`/`EMAIL_FROM` en `.env.example`; y (2) los endpoints de
> `/api/v1/invoice-pdf/*` ahora requieren autenticación con API key por
> tenant (`X-API-Key`), no un `Authorization: Bearer TOKEN` de un JWT de
> usuario. Ver `README.md`, `SECURITY.md` y `CURL_EXAMPLES.md` para el estado
> actual.

## Descripción

Se ha implementado un sistema completo para generar PDFs de facturas electrónicas que cumple con el formato oficial del SRI de Ecuador. El PDF se genera automáticamente cuando la factura es **RECIBIDA** por el SRI.

## Características Implementadas

### 1. Generación Automática de PDF
- **Trigger**: Cuando el estado de la factura en el SRI es "RECIBIDA"
- **Formato**: Replica exactamente el formato oficial del SRI mostrado en la imagen
- **Tecnología**: Puppeteer para generar PDFs desde HTML

### 2. Almacenamiento
- **Base de Datos**: Nueva tabla `InvoicePDF` para gestionar los PDFs
- **Archivos**: Los PDFs se guardan como archivos temporales y como Buffer en la BD
- **Metadatos**: Se almacena información como tamaño, fechas, estado, etc.

### 3. API Endpoints
Nuevos endpoints para gestionar los PDFs:

```
GET /api/v1/invoice-pdf/                    # Listar todos los PDFs
GET /api/v1/invoice-pdf/invoice/:facturaId  # PDF por ID de factura  
GET /api/v1/invoice-pdf/access-key/:clave   # PDF por clave de acceso
GET /api/v1/invoice-pdf/download/:clave     # Descargar PDF
POST /api/v1/invoice-pdf/regenerate/:id     # Regenerar PDF
```

## Arquitectura

### Flujo de Proceso
1. Se crea la factura (estado: PENDIENTE)
2. Se firma el XML con el certificado
3. Se envía al SRI para autorización
4. **Si el SRI responde "RECIBIDA"** → Se genera automáticamente el PDF
5. El PDF se guarda en la tabla InvoicePDF

### Modelos de Datos

#### InvoicePDF
```typescript
{
  factura_id: string;           // Referencia a la factura
  claveAcceso: string;          // Clave de acceso única
  pdf_path: string;             // Ruta del archivo PDF
  pdf_buffer?: Buffer;          // Contenido del PDF
  fecha_generacion: Date;       // Cuando se generó
  estado: 'GENERADO' | 'ERROR'; // Estado del PDF
  tamano_archivo: number;       // Tamaño en bytes
  numero_autorizacion: string;  // Número de autorización SRI
  fecha_autorizacion: Date;     // Fecha de autorización SRI
}
```

#### Invoice (campos añadidos)
```typescript
{
  datos_originales?: string;    // JSON de datos originales para PDF
  // ... otros campos existentes
}
```

#### Product (campos añadidos)
```typescript
{
  descripcion_adicional?: string;  // Para detalles adicionales en PDF
  // ... otros campos existentes
}
```

## Formato del PDF

El PDF generado incluye:

### Cabecera
- Logo de la empresa (placeholder "NO TIENE LOGO")
- Información de la empresa emisora
- RUC en caja destacada
- Número de autorización del SRI
- Fecha y hora de autorización
- Ambiente (PRUEBAS/PRODUCCIÓN)
- Tipo de emisión (NORMAL/CONTINGENCIA)
- Clave de acceso con código de barras simulado

### Información del Cliente
- Razón social/nombres
- Identificación
- Dirección
- Fecha de emisión

### Detalles de Productos
- Cantidad
- Unidad
- Descripción
- Detalle adicional
- Precio unitario
- Descuentos
- Precio total

### Totales
- Subtotal 12%
- Subtotal exento IVA
- Subtotal sin impuestos
- Total descuentos
- ICE
- IVA 12%
- IRBPNR
- Propina
- **VALOR TOTAL**

### Información Adicional
- Email del cliente
- Teléfono del cliente
- Forma de pago

## Dependencias Añadidas

```json
{
  "puppeteer": "^21.x.x",
  "@types/puppeteer": "^5.x.x"
}
```

## Configuración para Desarrollo

### Mocks para Testing
- Puppeteer está mockeado en los tests para evitar problemas de configuración
- Los PDFs se simulan con contenido mock durante las pruebas

### Variables de Entorno
- Los PDFs se guardan en el directorio temporal del sistema
- En producción se recomienda configurar un directorio específico

## Uso

### Generar PDF Manualmente
```typescript
import { generateInvoicePDF } from './utils/pdf.utils';

const pdfBuffer = await generateInvoicePDF({
  factura: datosFactura,
  empresa: empresaData,
  cliente: clienteData,
  productos: productosData,
  claveAcceso: '1234567890...',
  secuencial: '000000001',
  fechaEmision: new Date(),
  numeroAutorizacion: '1234567890...',
  fechaAutorizacion: new Date()
});
```

### Descargar PDF via API
```bash
curl -H "Authorization: Bearer TOKEN" \
  "http://localhost:3000/api/v1/invoice-pdf/download/CLAVE_ACCESO" \
  --output factura.pdf
```

## Beneficios

1. **Cumplimiento Legal**: Formato exacto del SRI
2. **Automatización**: Generación automática al ser aprobada
3. **Trazabilidad**: Registro completo de PDFs generados
4. **Escalabilidad**: Uso de Puppeteer permite modificaciones fáciles
5. **Integración**: API completa para gestionar PDFs

## Próximos Pasos Sugeridos

1. **Optimización**: Considerar usar una cola de trabajos para generación masiva
2. **Almacenamiento**: Integrar con servicios de almacenamiento cloud (S3, etc.)
3. **Plantillas**: Permitir personalización de plantillas por empresa
4. **Códigos de Barras**: Implementar generación real de códigos de barras
5. **Logs**: Mejorar logging para auditoría de generación de PDFs

## Sistema de Envío de Emails (EN PREPARACIÓN)

### Campos Agregados al Modelo InvoicePDF
Se han agregado los siguientes campos para preparar el sistema de envío de emails:

```typescript
{
  // Campos existentes...
  
  // Campos para envío de emails
  email_estado: 'PENDIENTE' | 'ENVIADO' | 'ERROR' | 'NO_ENVIADO';
  email_destinatario?: string;           // Email del destinatario
  email_fecha_envio?: Date;              // Fecha de envío exitoso
  email_intentos: number;                // Número de intentos de envío
  email_ultimo_error?: string;           // Último error de envío
  email_enviado_por?: string;            // ID del usuario que envió
}
```

### Endpoints de Email Preparados

```bash
# Solicitar envío de PDF por email
POST /api/v1/invoice-pdf/send-email/:claveAcceso
Body: { "email_destinatario": "cliente@email.com" }

# Consultar estado de envío de email
GET /api/v1/invoice-pdf/email-status/:claveAcceso

# Reintentar envío de email
POST /api/v1/invoice-pdf/retry-email/:claveAcceso
```

### Utilidades de Email Creadas

- **📧 email.utils.ts**: Funciones preparadas para envío de emails
  - `generateInvoiceEmailTemplate()`: Genera plantilla HTML para emails
  - `prepareEmailConfig()`: Prepara configuración de envío
  - `isValidEmail()`: Validación de formato de email
  - `sendInvoiceEmail()`: Función principal (por implementar)

### Estados de Email

- **NO_ENVIADO**: Estado inicial, email no solicitado
- **PENDIENTE**: Email en cola para envío
- **ENVIADO**: Email enviado exitosamente
- **ERROR**: Error en el último intento de envío

### Plantilla de Email

La plantilla incluye:
- Diseño responsive y profesional
- Información de la factura (clave de acceso, autorización, fechas)
- PDF adjunto
- Información de contacto de la empresa
- Formato HTML y texto plano

### Próxima Implementación

Para completar el sistema de emails, será necesario:

1. **Proveedor de Email**: Configurar Nodemailer, SendGrid, SES, etc.
2. **Variables de Entorno**: SMTP/API credentials
3. **Cola de Trabajos**: Para procesar envíos asíncronos
4. **Plantillas Personalizables**: Por empresa
5. **Logs de Auditoría**: Registro completo de envíos

```javascript
// Ejemplo de configuración futura
const emailConfig = {
  provider: 'nodemailer', // or 'sendgrid', 'ses'
  smtp: {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  }
};
```

## Correcciones Implementadas

### Corrección de Visualización de Clave de Acceso
- **Problema**: La clave de acceso se cortaba incorrectamente debido a `word-break: break-all`
- **Solución**: Implementado formateo correcto con:
  - Fuente monospace (Courier New) para mejor legibilidad
  - Tamaño de fuente optimizado (7px)
  - `overflow-wrap: break-word` para cortes apropiados
  - Espaciado de letras mejorado
- **Resultado**: La clave de acceso se muestra como un número continuo y legible

### Eliminación de Código de Barras Simulado
- **Decisión**: Remover la simulación visual del código de barras (`||||| |||| ||||| ||||`)
- **Razón**: No es requerido por el SRI para la validez legal del documento
- **Beneficio**: PDF más limpio y profesional
- **Estado**: ✅ **COMPLETADO** - El SRI no requiere código de barras visual

### Mejoras Visuales
- ~~Código de barras simulado más visible~~ → **ELIMINADO** ✅
- Mejor alineación de la clave de acceso
- Formateo consistente con el estándar del SRI
- **PDF más limpio y profesional sin elementos simulados** 