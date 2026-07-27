import mongoose, { Schema, Document } from 'mongoose';

/**
 * Interfaz del modelo InvoicePDF
 *
 * IMPORTANTE: Este modelo ya NO almacena el pdf_buffer en la base de datos
 * para evitar problemas de tamaño. En su lugar, almacena:
 * - pdf_url: con PDF_STORAGE_PROVIDER=s3 (default recomendado en
 *   producción), esto NO es una URL pública: es la key del objeto en el
 *   bucket privado de S3 (ver src/services/storage/s3.storage.ts), y las
 *   descargas se sirven vía URLs presignadas de corta duración generadas
 *   bajo demanda, nunca esta cadena directamente. Solo es una URL pública
 *   real con los proveedores cloudinary/local.
 * - pdf_public_id: ID único para gestionar el archivo
 * - pdf_provider: Proveedor utilizado (cloudinary, local, s3, etc.)
 */
export interface IInvoicePDF extends Document {
  factura_id: string;
  claveAcceso: string;

  // Información del almacenamiento (sin buffer)
  pdf_url: string; // Key de S3 (proveedor s3) o URL pública (cloudinary/local) -- ver comentario arriba
  pdf_public_id: string; // ID único en el proveedor (para eliminar/actualizar)
  pdf_provider: string; // Proveedor: cloudinary, local, s3, azure, etc.

  fecha_generacion: Date;
  estado: 'GENERADO' | 'ERROR';
  tamano_archivo: number;
  numero_autorizacion: string;
  fecha_autorizacion: Date;

  // Email sending fields
  email_estado: 'PENDIENTE' | 'ENVIADO' | 'ERROR' | 'NO_ENVIADO';
  email_destinatario?: string;
  email_fecha_envio?: Date;
  email_intentos: number;
  email_ultimo_error?: string;
  email_enviado_por?: string; // ID del usuario que envió
}

const InvoicePDFSchema: Schema = new Schema({
  factura_id: { type: String, required: true, ref: 'Invoice' },
  claveAcceso: { type: String, required: true, unique: true },

  // Campos actualizados para el nuevo sistema de almacenamiento
  // Obligatorios solo cuando el RIDE se generó de verdad.
  //
  // Antes eran `required: true` a secas, y el camino de error del servicio
  // guarda un registro con estado 'ERROR' y estas dos cadenas vacías. Es
  // decir: el registro cuya única función es dejar constancia de que la
  // generación falló era, él mismo, invalidable — Mongoose lo rechazaba con
  // "InvoicePDF validation failed" y el fallo original desaparecía sin dejar
  // rastro en la base de datos. Un fallo de PDF quedaba totalmente invisible
  // salvo en los logs del contenedor.
  //
  // Los otros cuatro modelos de PDF nunca marcaron estos campos como
  // requeridos, así que este defecto era exclusivo de las facturas.
  pdf_url: {
    type: String,
    required: function (this: IInvoicePDF) {
      return this.estado !== 'ERROR';
    },
  }, // Key de S3 o URL pública -- ver el comentario en IInvoicePDF arriba
  pdf_public_id: {
    type: String,
    required: function (this: IInvoicePDF) {
      return this.estado !== 'ERROR';
    },
  }, // ID único en el proveedor
  pdf_provider: { type: String, required: true, default: 'local' }, // Proveedor de almacenamiento

  fecha_generacion: { type: Date, default: Date.now },
  estado: { type: String, enum: ['GENERADO', 'ERROR'], default: 'GENERADO' },
  tamano_archivo: { type: Number, required: true },
  numero_autorizacion: { type: String, required: true },
  fecha_autorizacion: { type: Date, required: true },

  // Email sending fields
  email_estado: {
    type: String,
    enum: ['PENDIENTE', 'ENVIADO', 'ERROR', 'NO_ENVIADO'],
    required: true,
    default: 'NO_ENVIADO',
  },
  email_destinatario: { type: String },
  email_fecha_envio: { type: Date },
  email_intentos: { type: Number, required: true, default: 0 },
  email_ultimo_error: { type: String },
  email_enviado_por: { type: String },
});

// Índice para búsquedas rápidas por factura
InvoicePDFSchema.index({ factura_id: 1 });
InvoicePDFSchema.index({ pdf_public_id: 1 });

export default mongoose.model<IInvoicePDF>('InvoicePDF', InvoicePDFSchema);
