import { Schema, model, Document, Types } from 'mongoose';

export interface IIssuingCompany extends Document {
  ruc: string;
  razon_social: string;
  nombre_comercial: string;
  direccion?: string;
  direccion_matriz?: string;
  direccion_establecimiento?: string;
  telefono?: string;
  email?: string;
  codigo_establecimiento: string;
  punto_emision: string;
  tipo_ambiente: number;
  tipo_emision: number;
  obligado_contabilidad?: boolean;
  contribuyente_especial?: string;
  email_notificacion?: string;
  certificate?: string;
  certificate_password?: string;
  // Vestigial once tenants are provisioned by admins rather than tied 1:1 to
  // a registering User (the /register flow that created this coupling was
  // retired in Phase 2) — kept optional rather than removed since later
  // phases may still reference it.
  user_id?: Types.ObjectId;
  active: boolean;
  onboarded_at?: Date;
  created_by?: Types.ObjectId; // Reference to the admin User who provisioned this tenant
}

const schema = new Schema<IIssuingCompany>(
  {
    ruc: { type: String, required: true, unique: true },
    razon_social: { type: String, required: true },
    nombre_comercial: { type: String, required: true },
    direccion: { type: String },
    direccion_matriz: { type: String },
    direccion_establecimiento: { type: String },
    telefono: { type: String },
    email: { type: String },
    codigo_establecimiento: { type: String, required: true, default: '001' },
    punto_emision: { type: String, required: true, default: '001' },
    tipo_ambiente: { type: Number, required: true, default: 1 }, // 1 = Pruebas, 2 = Producción
    tipo_emision: { type: Number, required: true, default: 1 }, // 1 = Normal
    obligado_contabilidad: { type: Boolean, default: false },
    contribuyente_especial: { type: String },
    email_notificacion: { type: String },
    // select: false so IssuingCompany.find()/findOne() never leak these fields
    // by default; callers that need to sign a document must explicitly
    // .select('+certificate +certificate_password').
    certificate: { type: String, select: false },
    certificate_password: { type: String, select: false },
    user_id: { type: Schema.Types.ObjectId, ref: 'User' },
    active: { type: Boolean, required: true, default: true },
    onboarded_at: { type: Date },
    created_by: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true, // Add createdAt and updatedAt
  },
);

// Index for better performance
// El índice de ruc ya se crea automáticamente con unique: true
schema.index({ user_id: 1 });

export default model<IIssuingCompany>('IssuingCompany', schema);
