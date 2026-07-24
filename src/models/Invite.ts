import { Schema, model, Document, Types } from 'mongoose';

export interface IInvite extends Document {
  empresa_emisora_id: Types.ObjectId;
  token_hash: string;
  expires_at: Date;
  used_at?: Date;
  created_by?: Types.ObjectId; // Reference to the admin User who issued this invite
}

const schema = new Schema<IInvite>(
  {
    empresa_emisora_id: { type: Schema.Types.ObjectId, ref: 'IssuingCompany', required: true },
    // SHA-256 hex digest of the raw invite token, same custody pattern as
    // ApiKey.key_hash — the raw token is only ever handed to the invitee.
    token_hash: { type: String, required: true, unique: true },
    expires_at: { type: Date, required: true },
    used_at: { type: Date },
    created_by: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    // No TTL index on purpose: expired/used invites are kept for the audit
    // trail rather than being auto-purged by MongoDB.
    timestamps: true,
  },
);

schema.index({ empresa_emisora_id: 1 });

export default model<IInvite>('Invite', schema);
