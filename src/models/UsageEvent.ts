import { Schema, model, Document, Types } from 'mongoose';
import type { TipoDocumento } from '../utils/firma.utils';

export interface IUsageEvent extends Document {
  empresa_emisora_id: Types.ObjectId;
  document_type: TipoDocumento;
  document_id: Types.ObjectId;
  clave_acceso: string;
  sri_estado: string;
}

const schema = new Schema<IUsageEvent>(
  {
    empresa_emisora_id: { type: Schema.Types.ObjectId, ref: 'IssuingCompany', required: true },
    document_type: { type: String, enum: ['01', '04', '05', '06', '07'], required: true },
    document_id: { type: Schema.Types.ObjectId, required: true },
    clave_acceso: { type: String, required: true },
    sri_estado: { type: String, required: true },
  },
  {
    timestamps: true,
  },
);

schema.index({ empresa_emisora_id: 1, createdAt: 1 });
schema.index({ clave_acceso: 1 });

export default model<IUsageEvent>('UsageEvent', schema);
