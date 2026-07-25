export default {
  openapi: '3.0.0',
  info: {
    title: 'Sistema de Facturación Electrónica API',
    version: '1.0.0',
    description:
      'API multi-tenant de Facturación Electrónica con integración al SRI Ecuador. Incluye generación automática de PDFs cuando el SRI confirma la recepción de facturas. ' +
      'Este documento cubre únicamente la API de facturación para sistemas cliente (`/api/v1/*`), autenticada con API key por tenant. ' +
      'El backoffice de administración (`/admin/api/*`, JWT de administrador) y el flujo público de onboarding por invitación (`/onboarding/api/*`) existen y están en producción, ' +
      'pero no se documentan aquí — ver README.md, SECURITY.md y CURL_EXAMPLES.md para esos flujos.',
  },
  security: [{ ApiKeyAuth: [] }],
  paths: {
    '/api/v1/identification-type': {
      get: {
        tags: ['Identification Type Management'],
        summary: 'List IdentificationType',
        description:
          'Global, read-only SRI catalog shared by every tenant. There is no create/update/delete endpoint on the public /api/v1 surface — catalog maintenance is an admin-only concern, not a per-tenant one.',
        responses: { '200': { description: 'OK' } },
      },
    },
    '/api/v1/identification-type/{id}': {
      get: {
        tags: ['Identification Type Management'],
        summary: 'Get TipoIdentificacion by id',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
    },
    '/api/v1/issuing-company': {
      get: {
        tags: ['Issuing Company Management'],
        summary: "Get the authenticated tenant's own company",
        description:
          'Tenant self-service: always resolves to the caller’s own IssuingCompany via the authenticated API key—there is no :id param and no way to look up another tenant’s company. certificate/certificate_password are never included in the response.',
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/EmpresaEmisora' } } },
          },
          '401': { description: 'API key missing or invalid' },
          '404': { description: "The authenticated tenant's company no longer exists" },
        },
      },
      put: {
        tags: ['Issuing Company Management'],
        summary: "Update the authenticated tenant's own company profile",
        description:
          'Updates only the authenticated tenant’s own record, restricted to an explicit field whitelist. ruc, active, certificate, certificate_password and _id can never be changed through this endpoint—ruc is immutable tenant identity, active cannot be self-toggled, and certificate fields are only ever set via PUT /api/v1/issuing-company/certificate.',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/IssuingCompanySelfServiceUpdatePayload' } },
          },
        },
        responses: {
          '200': {
            description: 'Updated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/EmpresaEmisora' } } },
          },
          '401': { description: 'API key missing or invalid' },
          '404': { description: "The authenticated tenant's company no longer exists" },
        },
      },
    },
    '/api/v1/issuing-company/certificate': {
      put: {
        tags: ['Issuing Company Management'],
        summary: "Upload/replace the authenticated tenant's P12 digital certificate",
        description:
          'Verifies the incoming P12 (base64) actually opens with the given password (see src/utils/certificate.utils.ts#verifyP12Password) before encrypting and storing both the certificate and its password on the authenticated tenant’s own company. Nothing is stored if the P12 does not open.',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CertificateUploadPayload' } },
          },
        },
        responses: {
          '200': { description: 'Certificate updated' },
          '400': {
            description: 'certificate/certificate_password missing, or the P12 does not open with the given password',
          },
          '401': { description: 'API key missing or invalid' },
          '404': { description: "The authenticated tenant's company no longer exists" },
        },
      },
    },
    '/api/v1/client': {
      get: { tags: ['Client Management'], summary: 'List Clients', responses: { '200': { description: 'OK' } } },
      post: {
        tags: ['Client Management'],
        summary: 'Create Cliente',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ClientePayload' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/client/{id}': {
      get: {
        tags: ['Client Management'],
        summary: 'Get Cliente',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
      put: {
        tags: ['Client Management'],
        summary: 'Update Cliente',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ClientePayload' } },
          },
        },
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Client Management'],
        summary: 'Delete Cliente',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/v1/product': {
      get: { tags: ['Product Management'], summary: 'List Products', responses: { '200': { description: 'OK' } } },
      post: {
        tags: ['Product Management'],
        summary: 'Create Producto',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ProductoPayload' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/product/{id}': {
      get: {
        tags: ['Product Management'],
        summary: 'Get Producto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
      put: {
        tags: ['Product Management'],
        summary: 'Update Producto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ProductoPayload' } },
          },
        },
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Product Management'],
        summary: 'Delete Producto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/v1/invoice': {
      get: { tags: ['Invoice CRUD'], summary: 'List Invoices', responses: { '200': { description: 'OK' } } },
      post: {
        tags: ['Invoice CRUD'],
        summary: 'Create Factura',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Factura' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/invoice/complete': {
      post: {
        tags: ['Invoice Processing'],
        summary: 'Create Factura with details',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/FacturaComplete' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/invoice/{id}': {
      get: {
        tags: ['Invoice CRUD'],
        summary: 'Get Factura',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
      put: {
        tags: ['Invoice CRUD'],
        summary: 'Update Factura',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/FacturaUpdatePayload' } },
          },
        },
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Invoice CRUD'],
        summary: 'Delete Factura',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/v1/credit-note': {
      get: { tags: ['Credit Note CRUD'], summary: 'List Credit Notes', responses: { '200': { description: 'OK' } } },
      post: {
        tags: ['Credit Note CRUD'],
        summary: 'Create Nota de Crédito',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/NotaCredito' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/credit-note/complete': {
      post: {
        tags: ['Credit Note Processing'],
        summary: 'Create Nota de Crédito with details (XML, firma, envío y autorización SRI)',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/NotaCreditoComplete' } },
          },
        },
        responses: {
          '201': { description: 'Created' },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/api/v1/credit-note/{id}': {
      get: {
        tags: ['Credit Note CRUD'],
        summary: 'Get Nota de Crédito',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
      put: {
        tags: ['Credit Note CRUD'],
        summary: 'Update Nota de Crédito',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/NotaCredito' } },
          },
        },
        responses: { '200': { description: 'Updated' }, '404': { description: 'Not found' } },
      },
      delete: {
        tags: ['Credit Note CRUD'],
        summary: 'Delete Nota de Crédito',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } },
      },
    },
    '/api/v1/credit-note/{id}/pdf': {
      get: {
        tags: ['Credit Note Processing'],
        summary: 'Get Nota de Crédito PDF (RIDE) info',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
    },
    '/api/v1/debit-note': {
      get: { tags: ['Debit Note CRUD'], summary: 'List Debit Notes', responses: { '200': { description: 'OK' } } },
      post: {
        tags: ['Debit Note CRUD'],
        summary: 'Create Nota de Débito',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/NotaDebito' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/debit-note/complete': {
      post: {
        tags: ['Debit Note Processing'],
        summary: 'Create Nota de Débito completa (XML, firma, envío y autorización SRI)',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/NotaDebitoComplete' } },
          },
        },
        responses: {
          '201': { description: 'Created' },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/api/v1/debit-note/{id}': {
      get: {
        tags: ['Debit Note CRUD'],
        summary: 'Get Nota de Débito',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
      put: {
        tags: ['Debit Note CRUD'],
        summary: 'Update Nota de Débito',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/NotaDebito' } },
          },
        },
        responses: { '200': { description: 'Updated' }, '404': { description: 'Not found' } },
      },
      delete: {
        tags: ['Debit Note CRUD'],
        summary: 'Delete Nota de Débito',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } },
      },
    },
    '/api/v1/debit-note/{id}/pdf': {
      get: {
        tags: ['Debit Note Processing'],
        summary: 'Get Nota de Débito PDF (RIDE) info',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
    },
    '/api/v1/delivery-note': {
      get: {
        tags: ['Delivery Note CRUD'],
        summary: 'List Delivery Notes',
        responses: { '200': { description: 'OK' } },
      },
      post: {
        tags: ['Delivery Note CRUD'],
        summary: 'Create Guía de Remisión',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/GuiaRemision' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/delivery-note/complete': {
      post: {
        tags: ['Delivery Note Processing'],
        summary: 'Create Guía de Remisión completa (XML, firma, envío y autorización SRI)',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/GuiaRemisionComplete' } },
          },
        },
        responses: {
          '201': { description: 'Created' },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/api/v1/delivery-note/{id}': {
      get: {
        tags: ['Delivery Note CRUD'],
        summary: 'Get Guía de Remisión',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
      put: {
        tags: ['Delivery Note CRUD'],
        summary: 'Update Guía de Remisión',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/GuiaRemision' } },
          },
        },
        responses: { '200': { description: 'Updated' }, '404': { description: 'Not found' } },
      },
      delete: {
        tags: ['Delivery Note CRUD'],
        summary: 'Delete Guía de Remisión',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } },
      },
    },
    '/api/v1/delivery-note/{id}/pdf': {
      get: {
        tags: ['Delivery Note Processing'],
        summary: 'Get Guía de Remisión PDF (RIDE) info',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
    },
    '/api/v1/withholding': {
      get: { tags: ['Withholding CRUD'], summary: 'List Withholdings', responses: { '200': { description: 'OK' } } },
      post: {
        tags: ['Withholding CRUD'],
        summary: 'Create Comprobante de Retención',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Retencion' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/withholding/complete': {
      post: {
        tags: ['Withholding Processing'],
        summary: 'Create Comprobante de Retención ATS 2.0.0 completo (XML, firma, envío y autorización SRI)',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RetencionComplete' } },
          },
        },
        responses: {
          '201': { description: 'Created' },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/api/v1/withholding/{id}': {
      get: {
        tags: ['Withholding CRUD'],
        summary: 'Get Comprobante de Retención',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
      put: {
        tags: ['Withholding CRUD'],
        summary: 'Update Comprobante de Retención',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Retencion' } },
          },
        },
        responses: { '200': { description: 'Updated' }, '404': { description: 'Not found' } },
      },
      delete: {
        tags: ['Withholding CRUD'],
        summary: 'Delete Comprobante de Retención',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } },
      },
    },
    '/api/v1/withholding/{id}/pdf': {
      get: {
        tags: ['Withholding Processing'],
        summary: 'Get Comprobante de Retención PDF (RIDE) info',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
    },
    '/api/v1/invoice-detail': {
      get: {
        tags: ['Invoice Detail Management'],
        summary: 'List InvoiceDetail',
        responses: { '200': { description: 'OK' } },
      },
      post: {
        tags: ['Invoice Detail Management'],
        summary: 'Create FacturaDetalle',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/FacturaDetallePayload' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/invoice-detail/{id}': {
      get: {
        tags: ['Invoice Detail Management'],
        summary: 'Get FacturaDetalle',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
      put: {
        tags: ['Invoice Detail Management'],
        summary: 'Update FacturaDetalle',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/FacturaDetallePayload' } },
          },
        },
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Invoice Detail Management'],
        summary: 'Delete FacturaDetalle',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/v1/invoice-pdf': {
      get: {
        tags: ['PDF Management'],
        summary: 'Listar todos los PDFs generados',
        description:
          'Obtiene una lista de todos los PDFs de facturas que han sido generados automáticamente cuando el SRI confirma la recepción (estado RECIBIDA).',
        responses: {
          '200': {
            description: 'Lista de PDFs obtenida exitosamente',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/InvoicePDF' },
                    },
                    pagination: {
                      type: 'object',
                      properties: {
                        total: { type: 'integer' },
                        page: { type: 'integer' },
                        pages: { type: 'integer' },
                        limit: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
          '401': { description: 'No autorizado' },
          '500': { description: 'Error del servidor' },
        },
      },
    },
    '/api/v1/invoice-pdf/invoice/{facturaId}': {
      get: {
        tags: ['PDF Management'],
        summary: 'Obtener PDF por ID de factura',
        description: 'Busca el registro del PDF generado automáticamente para una factura específica usando su ID.',
        parameters: [
          {
            name: 'facturaId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'ID de la factura',
            example: '64f8a1b2c3d4e5f6a7b8c9d2',
          },
        ],
        responses: {
          '200': {
            description: 'PDF encontrado',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/InvoicePDF' } },
            },
          },
          '404': { description: 'PDF no encontrado - La factura aún no ha sido confirmada por el SRI o no existe' },
          '401': { description: 'No autorizado' },
          '500': { description: 'Error del servidor' },
        },
      },
    },
    '/api/v1/invoice-pdf/access-key/{claveAcceso}': {
      get: {
        tags: ['PDF Management'],
        summary: 'Obtener PDF por clave de acceso',
        description: 'Busca el registro del PDF usando la clave de acceso de 49 dígitos de la factura electrónica.',
        parameters: [
          {
            name: 'claveAcceso',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 49, maxLength: 49 },
            description: 'Clave de acceso de 49 dígitos de la factura',
            example: '1705202501012345678900110010010000000011234567890',
          },
        ],
        responses: {
          '200': {
            description: 'PDF encontrado',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/InvoicePDF' } },
            },
          },
          '404': { description: 'PDF no encontrado para esta clave de acceso' },
          '401': { description: 'No autorizado' },
          '500': { description: 'Error del servidor' },
        },
      },
    },
    '/api/v1/invoice-pdf/download/{claveAcceso}': {
      get: {
        tags: ['PDF Management'],
        summary: 'Descargar el PDF (redirección a la URL pública)',
        description:
          'Redirige (302) a la URL pública del PDF en el proveedor de almacenamiento configurado (Cloudinary, local, etc.).',
        parameters: [
          {
            name: 'claveAcceso',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 49, maxLength: 49 },
            description: 'Clave de acceso de 49 dígitos de la factura',
          },
        ],
        responses: {
          '302': { description: 'Redirección a la URL pública del PDF' },
          '404': { description: 'PDF no encontrado o sin URL disponible' },
          '401': { description: 'No autorizado' },
          '500': { description: 'Error del servidor' },
        },
      },
    },
    '/api/v1/invoice-pdf/regenerate/{facturaId}': {
      post: {
        tags: ['PDF Management'],
        summary: 'Solicitar regeneración del PDF de una factura',
        description:
          'Registra una solicitud de regeneración del PDF. Actualmente responde con un acuse de recibo; la regeneración automática está planificada.',
        parameters: [
          {
            name: 'facturaId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'ID de la factura',
          },
        ],
        responses: {
          '200': { description: 'Solicitud de regeneración registrada' },
          '401': { description: 'No autorizado' },
          '500': { description: 'Error del servidor' },
        },
      },
    },
    '/api/v1/invoice-pdf/send-email/{claveAcceso}': {
      post: {
        tags: ['PDF Management'],
        summary: 'Solicitar el envío del PDF por email',
        description:
          'Marca el PDF para envío por email al destinatario indicado (estado PENDIENTE). El envío se procesa de forma asíncrona.',
        parameters: [
          {
            name: 'claveAcceso',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 49, maxLength: 49 },
            description: 'Clave de acceso de 49 dígitos de la factura',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email_destinatario: { type: 'string', example: 'cliente@correo.com' },
                },
                required: ['email_destinatario'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Solicitud de envío encolada (estado PENDIENTE)' },
          '400': { description: 'email_destinatario es requerido' },
          '404': { description: 'PDF no encontrado' },
          '401': { description: 'No autorizado' },
          '500': { description: 'Error del servidor' },
        },
      },
    },
    '/api/v1/invoice-pdf/email-status/{claveAcceso}': {
      get: {
        tags: ['PDF Management'],
        summary: 'Consultar el estado de envío por email de un PDF',
        parameters: [
          {
            name: 'claveAcceso',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 49, maxLength: 49 },
            description: 'Clave de acceso de 49 dígitos de la factura',
          },
        ],
        responses: {
          '200': {
            description: 'Estado de envío del email',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    claveAcceso: { type: 'string' },
                    email_estado: { type: 'string', example: 'PENDIENTE' },
                    email_destinatario: { type: 'string' },
                    email_fecha_envio: { type: 'string', format: 'date-time' },
                    email_intentos: { type: 'integer' },
                    email_ultimo_error: { type: 'string' },
                  },
                },
              },
            },
          },
          '404': { description: 'PDF no encontrado' },
          '401': { description: 'No autorizado' },
          '500': { description: 'Error del servidor' },
        },
      },
    },
    '/api/v1/invoice-pdf/retry-email/{claveAcceso}': {
      post: {
        tags: ['PDF Management'],
        summary: 'Reintentar el envío por email de un PDF',
        description: 'Reinicia el estado de envío a PENDIENTE para un PDF cuyo email falló o no se ha enviado.',
        parameters: [
          {
            name: 'claveAcceso',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 49, maxLength: 49 },
            description: 'Clave de acceso de 49 dígitos de la factura',
          },
        ],
        responses: {
          '200': { description: 'Reintento de envío registrado (estado PENDIENTE)' },
          '400': { description: 'El email ya fue enviado exitosamente' },
          '404': { description: 'PDF no encontrado' },
          '401': { description: 'No autorizado' },
          '500': { description: 'Error del servidor' },
        },
      },
    },
  },
  tags: [
    {
      name: 'Invoice Processing',
      description: 'Endpoints for creating and processing electronic invoices.',
    },
    {
      name: 'PDF Management',
      description:
        'Gestión de PDFs generados automáticamente. Los PDFs se crean automáticamente cuando el SRI confirma la recepción de facturas (estado RECIBIDA).',
    },
    {
      name: 'Identification Type Management',
      description: 'Endpoints to manage identification types.',
    },
    {
      name: 'Issuing Company Management',
      description: 'Endpoints to manage issuing companies.',
    },
    {
      name: 'Client Management',
      description: 'Endpoints to manage clients.',
    },
    {
      name: 'Product Management',
      description: 'Endpoints to manage products.',
    },
    {
      name: 'Invoice CRUD',
      description: 'CRUD operations for invoices (not the full processing).',
    },
    {
      name: 'Invoice Detail Management',
      description: 'Endpoints to manage invoice details.',
    },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description:
          'API key por tenant (formato sk_live_...), provisionada desde el backoffice de administración. ' +
          'También puede enviarse como "Authorization: Bearer sk_live_...". Ver src/middleware/apiKeyAuth.ts.',
      },
    },
    schemas: {
      Factura: { type: 'object' },
      FacturaComplete: {
        type: 'object',
        properties: {
          factura: { $ref: '#/components/schemas/FacturaBody' },
        },
        required: ['factura'],
      },
      FacturaBody: {
        type: 'object',
        properties: {
          infoTributaria: { $ref: '#/components/schemas/FacturaInfoTributaria' },
          infoFactura: { $ref: '#/components/schemas/FacturaInfoFactura' },
          detalles: {
            type: 'array',
            items: { $ref: '#/components/schemas/FacturaDetalleItem' },
          },
        },
        required: ['infoTributaria', 'infoFactura', 'detalles'],
      },
      FacturaInfoTributaria: {
        type: 'object',
        properties: {
          ruc: { type: 'string', example: '0106079783001' },
        },
        required: ['ruc'],
      },
      FacturaInfoFactura: {
        type: 'object',
        properties: {
          fechaEmision: { type: 'string', example: '17/05/2025', description: 'Formato DD/MM/YYYY' },
          tipoIdentificacionComprador: { type: 'string', example: '05' },
          identificacionComprador: { type: 'string', example: '0106079783' },
          razonSocialComprador: { type: 'string', example: 'Juan Pérez' },
          totalSinImpuestos: { type: 'string', example: '100.00' },
          importeTotal: { type: 'string', example: '112.00' },
        },
        required: [
          'fechaEmision',
          'tipoIdentificacionComprador',
          'identificacionComprador',
          'razonSocialComprador',
          'totalSinImpuestos',
          'importeTotal',
        ],
      },
      FacturaDetalleItem: {
        type: 'object',
        properties: {
          detalle: { $ref: '#/components/schemas/FacturaDetalleData' },
        },
        required: ['detalle'],
      },
      FacturaDetalleData: {
        type: 'object',
        properties: {
          codigoPrincipal: { type: 'string', example: 'P001' },
          descripcion: { type: 'string', example: 'Laptop Lenovo' },
          cantidad: { type: 'string', example: '1.00' },
          precioUnitario: { type: 'string', example: '100.00' },
          precioTotalSinImpuesto: { type: 'string', example: '100.00' },
          impuestos: {
            type: 'array',
            items: { $ref: '#/components/schemas/FacturaDetalleImpuesto' },
          },
        },
        required: [
          'codigoPrincipal',
          'descripcion',
          'cantidad',
          'precioUnitario',
          'precioTotalSinImpuesto',
          'impuestos',
        ],
      },
      FacturaDetalleImpuesto: {
        type: 'object',
        properties: {
          impuesto: { $ref: '#/components/schemas/ImpuestoDetail' },
        },
        required: ['impuesto'],
      },
      ImpuestoDetail: {
        type: 'object',
        properties: {
          codigo: { type: 'string', example: '2' },
          codigoPorcentaje: { type: 'string', example: '4', description: 'Tabla 17 SRI. 4 = IVA 15%' },
          tarifa: { type: 'string', example: '15.00' },
          baseImponible: { type: 'string', example: '100.00' },
          valor: { type: 'string', example: '15.00' },
        },
        required: ['codigo', 'codigoPorcentaje', 'tarifa', 'baseImponible', 'valor'],
      },
      NotaCredito: { type: 'object' },
      NotaDebito: { type: 'object' },
      GuiaRemision: { type: 'object' },
      Retencion: { type: 'object' },
      RetencionComplete: {
        type: 'object',
        properties: {
          retencion: { $ref: '#/components/schemas/RetencionBody' },
        },
        required: ['retencion'],
      },
      RetencionBody: {
        type: 'object',
        properties: {
          infoTributaria: { $ref: '#/components/schemas/FacturaInfoTributaria' },
          infoCompRetencion: { $ref: '#/components/schemas/RetencionInfo' },
          docsSustento: {
            type: 'array',
            items: { $ref: '#/components/schemas/RetencionDocSustentoItem' },
          },
        },
        required: ['infoTributaria', 'infoCompRetencion', 'docsSustento'],
      },
      RetencionInfo: {
        type: 'object',
        properties: {
          fechaEmision: { type: 'string', example: '17/05/2025', description: 'Formato DD/MM/YYYY' },
          tipoIdentificacionSujetoRetenido: { type: 'string', example: '04', description: 'Tabla 6 SRI' },
          tipoSujetoRetenido: {
            type: 'string',
            example: '01',
            description: 'Tabla 14 Catálogo ATS. Obligatorio si la identificación es del exterior',
          },
          parteRel: { type: 'string', example: 'NO', description: 'Parte relacionada SI/NO' },
          razonSocialSujetoRetenido: { type: 'string', example: 'Proveedor S.A.' },
          identificacionSujetoRetenido: { type: 'string', example: '1713328506001' },
          periodoFiscal: { type: 'string', example: '05/2025', description: 'Formato MM/YYYY' },
        },
        required: [
          'fechaEmision',
          'tipoIdentificacionSujetoRetenido',
          'razonSocialSujetoRetenido',
          'identificacionSujetoRetenido',
          'periodoFiscal',
        ],
      },
      RetencionDocSustentoItem: {
        type: 'object',
        properties: {
          docSustento: {
            type: 'object',
            properties: {
              codSustento: { type: 'string', example: '01', description: 'Tabla 5 Catálogo ATS' },
              codDocSustento: { type: 'string', example: '01', description: 'Tabla 4 Catálogo ATS' },
              numDocSustento: { type: 'string', example: '001001000000123', description: '15 dígitos' },
              fechaEmisionDocSustento: { type: 'string', example: '10/05/2025' },
              fechaRegistroContable: { type: 'string', example: '10/05/2025' },
              numAutDocSustento: { type: 'string', example: '1005202501179001234500110010010000001231234567818' },
              pagoLocExt: { type: 'string', example: '01', description: 'Tabla 15 Catálogo ATS. 01 = pago local' },
              totalSinImpuestos: { type: 'string', example: '100.00' },
              importeTotal: { type: 'string', example: '115.00' },
              impuestosDocSustento: {
                type: 'array',
                items: { $ref: '#/components/schemas/RetencionImpuestoDocSustentoItem' },
              },
              retenciones: {
                type: 'array',
                items: { $ref: '#/components/schemas/RetencionDetalleItem' },
              },
              pagos: {
                type: 'array',
                items: { $ref: '#/components/schemas/RetencionPagoItem' },
              },
            },
            required: [
              'codSustento',
              'codDocSustento',
              'fechaEmisionDocSustento',
              'pagoLocExt',
              'totalSinImpuestos',
              'importeTotal',
              'impuestosDocSustento',
              'retenciones',
              'pagos',
            ],
          },
        },
        required: ['docSustento'],
      },
      RetencionImpuestoDocSustentoItem: {
        type: 'object',
        properties: {
          impuestoDocSustento: {
            type: 'object',
            properties: {
              codImpuestoDocSustento: { type: 'string', example: '2', description: 'Tabla 16 SRI. 2 = IVA' },
              codigoPorcentaje: { type: 'string', example: '4', description: 'Tabla 17/18 SRI' },
              baseImponible: { type: 'string', example: '100.00' },
              tarifa: { type: 'string', example: '15' },
              valorImpuesto: { type: 'string', example: '15.00' },
            },
            required: ['codImpuestoDocSustento', 'codigoPorcentaje', 'baseImponible', 'tarifa', 'valorImpuesto'],
          },
        },
        required: ['impuestoDocSustento'],
      },
      RetencionDetalleItem: {
        type: 'object',
        properties: {
          retencion: {
            type: 'object',
            properties: {
              codigo: { type: 'string', example: '1', description: 'Tabla 19 SRI. 1=Renta, 2=IVA, 6=ISD' },
              codigoRetencion: { type: 'string', example: '312', description: 'Tablas 20/21 SRI' },
              baseImponible: { type: 'string', example: '100.00' },
              porcentajeRetener: { type: 'string', example: '1.75' },
              valorRetenido: { type: 'string', example: '1.75' },
            },
            required: ['codigo', 'codigoRetencion', 'baseImponible', 'porcentajeRetener', 'valorRetenido'],
          },
        },
        required: ['retencion'],
      },
      RetencionPagoItem: {
        type: 'object',
        properties: {
          pago: {
            type: 'object',
            properties: {
              formaPago: { type: 'string', example: '01', description: 'Tabla 13 Catálogo ATS' },
              total: { type: 'string', example: '115.00' },
            },
            required: ['formaPago', 'total'],
          },
        },
        required: ['pago'],
      },
      GuiaRemisionComplete: {
        type: 'object',
        properties: {
          guia_remision: { $ref: '#/components/schemas/GuiaRemisionBody' },
        },
        required: ['guia_remision'],
      },
      GuiaRemisionBody: {
        type: 'object',
        properties: {
          infoTributaria: { $ref: '#/components/schemas/FacturaInfoTributaria' },
          infoGuiaRemision: { $ref: '#/components/schemas/GuiaRemisionInfo' },
          destinatarios: {
            type: 'array',
            items: { $ref: '#/components/schemas/GuiaRemisionDestinatarioItem' },
          },
        },
        required: ['infoTributaria', 'infoGuiaRemision', 'destinatarios'],
      },
      GuiaRemisionInfo: {
        type: 'object',
        properties: {
          fechaEmision: {
            type: 'string',
            example: '17/05/2025',
            description: 'Formato DD/MM/YYYY. Se usa para la clave de acceso',
          },
          dirPartida: { type: 'string', example: 'Av. Eloy Alfaro 34 y Av. Libertad' },
          razonSocialTransportista: { type: 'string', example: 'Transportes S.A.' },
          tipoIdentificacionTransportista: { type: 'string', example: '04', description: 'Tabla 6 SRI' },
          rucTransportista: { type: 'string', example: '1796875790001' },
          fechaIniTransporte: { type: 'string', example: '17/05/2025', description: 'Formato DD/MM/YYYY' },
          fechaFinTransporte: { type: 'string', example: '18/05/2025', description: 'Formato DD/MM/YYYY' },
          placa: { type: 'string', example: 'MCL0827' },
        },
        required: [
          'fechaEmision',
          'dirPartida',
          'razonSocialTransportista',
          'tipoIdentificacionTransportista',
          'rucTransportista',
          'fechaIniTransporte',
          'fechaFinTransporte',
          'placa',
        ],
      },
      GuiaRemisionDestinatarioItem: {
        type: 'object',
        properties: {
          destinatario: {
            type: 'object',
            properties: {
              identificacionDestinatario: { type: 'string', example: '1716849140001' },
              razonSocialDestinatario: { type: 'string', example: 'Juan Pérez' },
              dirDestinatario: { type: 'string', example: 'Av. Simón Bolívar S/N' },
              motivoTraslado: { type: 'string', example: 'Venta de mercadería' },
              ruta: { type: 'string', example: 'Quito - Cayambe - Otavalo' },
              codDocSustento: { type: 'string', example: '01', description: 'Tabla 3 SRI' },
              numDocSustento: { type: 'string', example: '001-001-000000123' },
              numAutDocSustento: { type: 'string', example: '1705202501179001234500110010010000000011234567810' },
              fechaEmisionDocSustento: { type: 'string', example: '17/05/2025' },
              detalles: {
                type: 'array',
                items: { $ref: '#/components/schemas/GuiaRemisionDetalleItem' },
              },
            },
            required: [
              'identificacionDestinatario',
              'razonSocialDestinatario',
              'dirDestinatario',
              'motivoTraslado',
              'detalles',
            ],
          },
        },
        required: ['destinatario'],
      },
      GuiaRemisionDetalleItem: {
        type: 'object',
        properties: {
          detalle: {
            type: 'object',
            properties: {
              codigoInterno: { type: 'string', example: 'P001' },
              codigoAdicional: { type: 'string', example: 'A001' },
              descripcion: { type: 'string', example: 'Laptop Lenovo' },
              cantidad: { type: 'string', example: '10.00', description: 'Sin precios: solo cantidades' },
            },
            required: ['descripcion', 'cantidad'],
          },
        },
        required: ['detalle'],
      },
      NotaDebitoComplete: {
        type: 'object',
        properties: {
          nota_debito: { $ref: '#/components/schemas/NotaDebitoBody' },
        },
        required: ['nota_debito'],
      },
      NotaDebitoBody: {
        type: 'object',
        properties: {
          infoTributaria: { $ref: '#/components/schemas/FacturaInfoTributaria' },
          infoNotaDebito: { $ref: '#/components/schemas/NotaDebitoInfo' },
          motivos: {
            type: 'array',
            items: { $ref: '#/components/schemas/NotaDebitoMotivoItem' },
          },
        },
        required: ['infoTributaria', 'infoNotaDebito', 'motivos'],
      },
      NotaDebitoInfo: {
        type: 'object',
        properties: {
          fechaEmision: { type: 'string', example: '17/05/2025', description: 'Formato DD/MM/YYYY' },
          tipoIdentificacionComprador: { type: 'string', example: '05' },
          identificacionComprador: { type: 'string', example: '0106079783' },
          razonSocialComprador: { type: 'string', example: 'Juan Pérez' },
          codDocModificado: { type: 'string', example: '01', description: 'Tabla 3 SRI. 01 = Factura' },
          numDocModificado: { type: 'string', example: '001-001-000000123' },
          fechaEmisionDocSustento: { type: 'string', example: '10/05/2025', description: 'Formato DD/MM/YYYY' },
          totalSinImpuestos: { type: 'string', example: '50.00' },
          impuestos: {
            type: 'array',
            items: { $ref: '#/components/schemas/FacturaDetalleImpuesto' },
            description: 'La tarifa de IVA corresponde a la fecha de emisión del documento de sustento',
          },
          valorTotal: { type: 'string', example: '57.50' },
          pagos: {
            type: 'array',
            items: { $ref: '#/components/schemas/NotaDebitoPagoItem' },
          },
        },
        required: [
          'fechaEmision',
          'tipoIdentificacionComprador',
          'identificacionComprador',
          'codDocModificado',
          'numDocModificado',
          'fechaEmisionDocSustento',
          'totalSinImpuestos',
          'impuestos',
          'valorTotal',
          'pagos',
        ],
      },
      NotaDebitoPagoItem: {
        type: 'object',
        properties: {
          pago: {
            type: 'object',
            properties: {
              formaPago: { type: 'string', example: '20', description: 'Tabla 24 SRI' },
              total: { type: 'string', example: '57.50' },
              plazo: { type: 'string', example: '15' },
              unidadTiempo: { type: 'string', example: 'dias' },
            },
            required: ['formaPago', 'total'],
          },
        },
        required: ['pago'],
      },
      NotaDebitoMotivoItem: {
        type: 'object',
        properties: {
          motivo: {
            type: 'object',
            properties: {
              razon: { type: 'string', example: 'Interés por mora' },
              valor: { type: 'string', example: '50.00' },
            },
            required: ['razon', 'valor'],
          },
        },
        required: ['motivo'],
      },
      NotaCreditoComplete: {
        type: 'object',
        properties: {
          nota_credito: { $ref: '#/components/schemas/NotaCreditoBody' },
        },
        required: ['nota_credito'],
      },
      NotaCreditoBody: {
        type: 'object',
        properties: {
          infoTributaria: { $ref: '#/components/schemas/FacturaInfoTributaria' },
          infoNotaCredito: { $ref: '#/components/schemas/NotaCreditoInfo' },
          detalles: {
            type: 'array',
            items: { $ref: '#/components/schemas/NotaCreditoDetalleItem' },
          },
        },
        required: ['infoTributaria', 'infoNotaCredito', 'detalles'],
      },
      NotaCreditoInfo: {
        type: 'object',
        properties: {
          fechaEmision: { type: 'string', example: '17/05/2025', description: 'Formato DD/MM/YYYY' },
          tipoIdentificacionComprador: { type: 'string', example: '05' },
          identificacionComprador: { type: 'string', example: '0106079783' },
          razonSocialComprador: { type: 'string', example: 'Juan Pérez' },
          codDocModificado: { type: 'string', example: '01', description: 'Tabla 3 SRI. 01 = Factura' },
          numDocModificado: { type: 'string', example: '001-001-000000123' },
          fechaEmisionDocSustento: { type: 'string', example: '10/05/2025', description: 'Formato DD/MM/YYYY' },
          totalSinImpuestos: { type: 'string', example: '100.00' },
          valorModificacion: { type: 'string', example: '115.00' },
          moneda: { type: 'string', example: 'DOLAR' },
          motivo: { type: 'string', example: 'DEVOLUCIÓN' },
        },
        required: [
          'fechaEmision',
          'tipoIdentificacionComprador',
          'identificacionComprador',
          'codDocModificado',
          'numDocModificado',
          'fechaEmisionDocSustento',
          'totalSinImpuestos',
          'valorModificacion',
          'motivo',
        ],
      },
      NotaCreditoDetalleItem: {
        type: 'object',
        properties: {
          detalle: { $ref: '#/components/schemas/NotaCreditoDetalleData' },
        },
        required: ['detalle'],
      },
      NotaCreditoDetalleData: {
        type: 'object',
        properties: {
          codigoInterno: { type: 'string', example: 'P001' },
          codigoAdicional: { type: 'string', example: 'A001' },
          descripcion: { type: 'string', example: 'Laptop Lenovo' },
          cantidad: { type: 'string', example: '1.00' },
          precioUnitario: { type: 'string', example: '100.00' },
          descuento: { type: 'string', example: '0.00' },
          precioTotalSinImpuesto: { type: 'string', example: '100.00' },
          impuestos: {
            type: 'array',
            items: { $ref: '#/components/schemas/FacturaDetalleImpuesto' },
          },
        },
        required: ['codigoInterno', 'descripcion', 'cantidad', 'precioUnitario', 'precioTotalSinImpuesto', 'impuestos'],
      },
      IssuingCompanySelfServiceUpdatePayload: {
        type: 'object',
        description:
          'Whitelisted fields a tenant may update about its own company profile (src/routes/issuingCompany.ts#UPDATABLE_FIELDS). Any other field in the body, including ruc, active, certificate, certificate_password or _id, is silently ignored.',
        properties: {
          razon_social: { type: 'string', example: 'Mi Empresa S.A.' },
          nombre_comercial: { type: 'string', example: 'Mi Tienda' },
          direccion: { type: 'string' },
          direccion_matriz: { type: 'string' },
          direccion_establecimiento: { type: 'string' },
          telefono: { type: 'string' },
          email: { type: 'string' },
          email_notificacion: { type: 'string' },
          codigo_establecimiento: { type: 'string', example: '001' },
          punto_emision: { type: 'string', example: '001' },
          tipo_ambiente: { type: 'number', example: 1 },
          tipo_emision: { type: 'number', example: 1 },
          obligado_contabilidad: { type: 'boolean' },
          contribuyente_especial: { type: 'string' },
        },
      },
      CertificateUploadPayload: {
        type: 'object',
        properties: {
          certificate: { type: 'string', description: 'P12 digital certificate, base64-encoded' },
          certificate_password: { type: 'string' },
        },
        required: ['certificate', 'certificate_password'],
      },
      ClientePayload: {
        type: 'object',
        properties: {
          tipo_identificacion_id: { type: 'string', example: 'ID_TIPO_IDENTIFICACION' },
          identificacion: { type: 'string', example: '0123456789' },
          razon_social: { type: 'string', example: 'Nombre Cliente' },
          // Add more fields according to your Client model
        },
        required: ['tipo_identificacion_id', 'identificacion', 'razon_social'],
      },
      ProductoPayload: {
        type: 'object',
        properties: {
          codigo: { type: 'string', example: 'PROD001' },
          descripcion: { type: 'string', example: 'Producto de Ejemplo' },
          precio_unitario: { type: 'number', example: 10.99 },
          // Add more fields according to your Product model
        },
        required: ['codigo', 'descripcion', 'precio_unitario'],
      },
      FacturaUpdatePayload: {
        type: 'object',
        properties: {
          // Define the fields that can be updated in an invoice
          // For example, you could allow updating the status or some specific information
          // This is just an example, adjust it to your needs
          observacion: { type: 'string', example: 'Alguna observación adicional' },
        },
      },
      FacturaDetallePayload: {
        type: 'object',
        properties: {
          factura_id: { type: 'string', example: 'ID_FACTURA' },
          producto_id: { type: 'string', example: 'ID_PRODUCTO' },
          cantidad: { type: 'number', example: 1 },
          precio_unitario: { type: 'number', example: 25.5 },
          // Add more fields according to your InvoiceDetail model
        },
        required: ['factura_id', 'producto_id', 'cantidad', 'precio_unitario'],
      },
      EmpresaEmisora: {
        type: 'object',
        properties: {
          ruc: { type: 'string' },
          razon_social: { type: 'string' },
          nombre_comercial: { type: 'string' },
          // Add more fields according to your IssuingCompany model
        },
      },
      Cliente: {
        type: 'object',
        properties: {
          identificacion: { type: 'string' },
          nombre: { type: 'string' },
          // Add more fields according to your Client model
        },
      },
      Producto: {
        type: 'object',
        properties: {
          codigo: { type: 'string' },
          nombre: { type: 'string' },
          precio_venta: { type: 'number' },
          // Add more fields according to your Product model
        },
      },
      FacturaUpdate: {
        type: 'object',
        properties: {
          // Define the fields that can be updated in an invoice
          // For example, you could allow updating the status or some specific information
          // This is just an example, adjust it to your needs
          estado: { type: 'string' },
          sri_estado: { type: 'string' },
        },
      },
      FacturaDetalle: {
        type: 'object',
        properties: {
          factura_id: { type: 'string' },
          producto_id: { type: 'string' },
          cantidad: { type: 'number' },
          precio_unitario: { type: 'number' },
          // Add more fields according to your InvoiceDetail model
        },
      },
      InvoicePDF: {
        type: 'object',
        properties: {
          _id: { type: 'string', example: '64f8a1b2c3d4e5f6a7b8c9d8' },
          factura_id: { type: 'string', example: '64f8a1b2c3d4e5f6a7b8c9d2' },
          clave_acceso: { type: 'string', example: '1705202501012345678900110010010000000011234567890' },
          numero_factura: { type: 'string', example: '001-001-000000001' },
          empresa_emisora: { type: 'string', example: 'Mi Empresa S.A.' },
          cliente: { type: 'string', example: 'Juan Pérez' },
          fecha_emision: { type: 'string', format: 'date-time', example: '2025-01-17T10:30:00.000Z' },
          total: { type: 'number', example: 112.0 },
          pdf_path: { type: 'string', example: '/uploads/pdfs/001-001-000000001.pdf' },
          file_size: { type: 'integer', example: 245760, description: 'Tamaño del archivo en bytes' },
          generado_automaticamente: {
            type: 'boolean',
            example: true,
            description: 'true si fue generado automáticamente al confirmar SRI',
          },
          sri_estado: { type: 'string', example: 'RECIBIDA', enum: ['RECIBIDA', 'DEVUELTA'] },
          fecha_generacion: { type: 'string', format: 'date-time', example: '2025-01-17T10:31:15.000Z' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
        required: ['factura_id', 'clave_acceso', 'numero_factura', 'pdf_path'],
      },
    },
  },
};
