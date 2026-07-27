import { Schema, model, Document, Types } from 'mongoose';

/**
 * Append-only record of every manual change to a secuencial counter.
 *
 * Seeding a counter is the one operation that can silently corrupt a
 * tenant's numbering: set it too high and the series gets a permanent gap
 * that nobody notices until the SRI asks why documents are missing, and
 * that gap cannot be repaired once the counter has moved past it. Since
 * the value is trusted operator input, the only way to answer "why does
 * this series start at 148?" later is to have recorded who changed it,
 * when, and from what.
 *
 * Only successful raises are recorded — a rejected lowering attempt
 * changed nothing, so there is nothing to attribute.
 */
export interface ISequenceAudit extends Document {
  empresa_emisora_id: Types.ObjectId;
  tipo_ambiente: number;
  codigo_establecimiento: string;
  punto_emision: string;
  document_type: string;
  /** Counter value before the change; null when the counter did not exist. */
  from: number | null;
  to: number;
  changed_by: string;
}

const schema = new Schema<ISequenceAudit>(
  {
    empresa_emisora_id: { type: Schema.Types.ObjectId, ref: 'IssuingCompany', required: true },
    tipo_ambiente: { type: Number, required: true },
    codigo_establecimiento: { type: String, required: true },
    punto_emision: { type: String, required: true },
    document_type: { type: String, required: true },
    from: { type: Number, default: null },
    to: { type: Number, required: true },
    changed_by: { type: String, required: true },
  },
  { timestamps: true },
);

schema.index({ empresa_emisora_id: 1, createdAt: -1 });

export default model<ISequenceAudit>('SequenceAudit', schema);
