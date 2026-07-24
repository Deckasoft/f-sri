import { Schema, model, Document } from 'mongoose';

// All Users are admins in v1 (the backoffice built in Phase 4). The enum is
// kept extensible for future roles rather than a plain boolean.
export type UserRole = 'admin';

export interface IUser extends Document {
  email: string;
  password: string;
  role: UserRole;
}

const userSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin'], required: true, default: 'admin' },
});

export default model<IUser>('User', userSchema);
