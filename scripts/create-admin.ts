/**
 * One-off bootstrap script: creates the very first admin User.
 *
 * Replaces the old MASTER_REGISTRATION_KEY self-service /register flow —
 * admins are now provisioned out-of-band by whoever operates the deployment,
 * not by anyone who can reach the API.
 *
 * Usage:
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=change-me npm run create-admin
 *   npm run create-admin -- admin@example.com change-me
 *
 * Not part of the Express app and not unit-tested (it's an operational
 * tool), but it does run through `npm run typecheck` since it lives outside
 * `src/` (excluded from tsconfig.build.json) but is still covered by the
 * default tsconfig.json used for `tsc --noEmit`.
 */
import dotenv from 'dotenv';

dotenv.config();

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { loadEnv } from '../src/config/env.config';
import User from '../src/models/User';

const BCRYPT_SALT_ROUNDS = 10;

const readCredentials = (): { email: string; password: string } => {
  const [argEmail, argPassword] = process.argv.slice(2);
  const email = argEmail ?? process.env.ADMIN_EMAIL;
  const password = argPassword ?? process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'Faltan credenciales: pasa ADMIN_EMAIL/ADMIN_PASSWORD como variables de entorno, ' +
        'o "npm run create-admin -- <email> <password>".',
    );
  }

  return { email, password };
};

const main = async (): Promise<void> => {
  const { email, password } = readCredentials();
  const { MONGO_URI } = loadEnv();

  await mongoose.connect(MONGO_URI);

  try {
    const existing = await User.findOne({ email });
    if (existing) {
      throw new Error(`Ya existe un usuario con el email ${email}`);
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const admin = new User({ email, password: hashedPassword, role: 'admin' });
    await admin.save();

    console.log(`✅ Usuario admin creado: ${email} (id ${String(admin._id)})`);
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((err: unknown) => {
  console.error('❌ No se pudo crear el usuario admin:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
