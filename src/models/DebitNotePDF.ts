import mongoose, { Schema, Document } from 'mongoose';

/**
 * PDF (RIDE) de una nota de débito.
 * Igual que InvoicePDF, no almacena el buffer, solo la referencia al archivo
 * en el proveedor. Con PDF_STORAGE_PROVIDER=s3 (default recomendado en
 * producción), pdf_url NO es una URL pública: es la key del objeto en el
 * bucket privado de S3 (ver src/services/storage/s3.storage.ts), y las
 * descargas se sirven vía URLs presignadas de corta duración generadas bajo
 * demanda. Solo es una URL pública real con los proveedores cloudinary/local.
 */
export interface IDebitNotePDF extends Document {
  nota_debito_id: string;
  claveAcceso: string;

  pdf_url: string; // Key de S3 (proveedor s3) o URL pública (cloudinary/local) -- ver comentario arriba
  pdf_public_id: string;
  pdf_provider: string;

  fecha_generacion: Date;
  estado: 'GENERADO' | 'ERROR';
  tamano_archivo: number;
  numero_autorizacion: string;
  fecha_autorizacion: Date;
}

const DebitNotePDFSchema: Schema = new Schema({
  nota_debito_id: { type: String, required: true, ref: 'DebitNote' },
  claveAcceso: { type: String, required: true, unique: true },

  pdf_url: { type: String },
  pdf_public_id: { type: String },
  pdf_provider: { type: String, default: 'local' },

  fecha_generacion: { type: Date, default: Date.now },
  estado: { type: String, enum: ['GENERADO', 'ERROR'], default: 'GENERADO' },
  tamano_archivo: { type: Number, required: true, default: 0 },
  numero_autorizacion: { type: String, required: true },
  fecha_autorizacion: { type: Date, required: true },
});

DebitNotePDFSchema.index({ nota_debito_id: 1 });
DebitNotePDFSchema.index({ pdf_public_id: 1 });

export default mongoose.model<IDebitNotePDF>('DebitNotePDF', DebitNotePDFSchema);
