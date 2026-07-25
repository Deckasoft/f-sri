import { Schema, model, Document, Types } from 'mongoose';

/**
 * One atomic counter per (tenant, SRI document type). Backs
 * src/utils/sequence.utils.ts#getNextSecuencial, which replaces the old
 * read-then-increment "find the highest existing secuencial and add 1"
 * logic that raced under concurrent requests for the same tenant.
 */
export interface ISequence extends Document {
  empresa_emisora_id: Types.ObjectId;
  document_type: string;
  current: number;
}

const schema = new Schema<ISequence>({
  empresa_emisora_id: { type: Schema.Types.ObjectId, ref: 'IssuingCompany', required: true },
  document_type: { type: String, required: true },
  current: { type: Number, required: true, default: 0 },
});

schema.index({ empresa_emisora_id: 1, document_type: 1 }, { unique: true });

export default model<ISequence>('Sequence', schema);
