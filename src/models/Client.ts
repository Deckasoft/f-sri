import { Schema, model, Document, Types } from 'mongoose';

export interface IClient extends Document {
  empresa_emisora_id: Types.ObjectId;
  tipo_identificacion_id: Types.ObjectId;
  identificacion: string;
  razon_social: string;
  direccion: string;
  email: string;
  telefono: string;
}

const schema = new Schema<IClient>({
  empresa_emisora_id: { type: Schema.Types.ObjectId, ref: 'IssuingCompany', required: true },
  tipo_identificacion_id: { type: Schema.Types.ObjectId, ref: 'IdentificationType', required: true },
  identificacion: { type: String, required: true },
  razon_social: { type: String, required: true },
  direccion: { type: String },
  email: { type: String },
  telefono: { type: String },
});

// Two tenants may each have a client with the same natural identificacion,
// but a tenant can't register the same client twice.
schema.index({ empresa_emisora_id: 1, identificacion: 1 }, { unique: true });

export default model<IClient>('Client', schema);
