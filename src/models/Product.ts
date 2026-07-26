import { Schema, model, Document, Types } from 'mongoose';

export interface IProduct extends Document {
  empresa_emisora_id: Types.ObjectId;
  codigo: string;
  descripcion: string;
  precio_unitario: number;
  tiene_iva: boolean;
  descripcion_adicional?: string;
}

const schema = new Schema<IProduct>({
  empresa_emisora_id: { type: Schema.Types.ObjectId, ref: 'IssuingCompany', required: true },
  codigo: { type: String, required: true },
  descripcion: { type: String, required: true },
  precio_unitario: { type: Number, required: true },
  tiene_iva: { type: Boolean, required: true },
  descripcion_adicional: { type: String },
});

// Two tenants may each have a product with the same natural codigo, but a
// tenant can't register the same code twice.
schema.index({ empresa_emisora_id: 1, codigo: 1 }, { unique: true });

export default model<IProduct>('Product', schema);
