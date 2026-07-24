import { Schema, model, Document, Types } from 'mongoose';

export interface IApiKey extends Document {
  empresa_emisora_id: Types.ObjectId;
  name: string;
  prefix: string;
  key_hash: string;
  last_used_at?: Date;
  revoked_at?: Date;
  created_by?: Types.ObjectId; // Reference to the admin User who created this key
}

const schema = new Schema<IApiKey>(
  {
    empresa_emisora_id: { type: Schema.Types.ObjectId, ref: 'IssuingCompany', required: true },
    name: { type: String, required: true },
    // First ~12 characters of the raw token (e.g. "sk_live_a1b2"), kept only
    // for backoffice display — the secret itself is never stored or
    // re-displayed after creation.
    prefix: { type: String, required: true },
    // SHA-256 hex digest of the full token, so lookup on every request is a
    // direct equality query instead of a per-request bcrypt comparison.
    key_hash: { type: String, required: true, unique: true },
    last_used_at: { type: Date },
    revoked_at: { type: Date },
    created_by: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
  },
);

schema.index({ empresa_emisora_id: 1 });

export default model<IApiKey>('ApiKey', schema);
