import { z } from 'zod';

/**
 * Esquema de las variables de entorno requeridas para que el proceso arranque
 * de forma segura. Cualquier variable ausente o con formato inválido debe
 * detener el arranque (fail fast) en lugar de degradar silenciosamente el
 * comportamiento en tiempo de petición (por ejemplo, firmando JWT con un
 * secreto vacío).
 */
const envSchema = z.object({
  JWT_SECRET: z.string().min(1, 'JWT_SECRET no puede estar vacío'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY debe tener 64 caracteres hexadecimales (32 bytes)'),
  MONGO_URI: z.string().min(1, 'MONGO_URI no puede estar vacío'),
  // Required (not defaulted to localhost) on purpose: it's used to build the
  // onboarding URL returned in invite-creation responses
  // (src/routes/admin/invite.ts). Defaulting it would let production silently
  // hand out localhost invite links instead of failing fast at startup — the
  // same fail-fast reasoning as the other vars in this schema. Phase 7's
  // deployment doc lists it as a required production env var for this reason.
  PUBLIC_URL: z.string().url('PUBLIC_URL debe ser una URL válida (p. ej. https://api.tuempresa.com)'),
  // Required, not optional: the authorization poll, and with it the PDF and
  // the email, run on the queue. Degrading to "no queue configured" would
  // mean comprobantes are sent to the SRI and then never asked about again —
  // silently, per document. Failing at startup is the lesser harm, and
  // matches how the other vars here are treated.
  REDIS_URL: z.string().min(1, 'REDIS_URL no puede estar vacío (p. ej. redis://redis:6379)'),
});

export type Env = z.infer<typeof envSchema>;

const formatIssues = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');

/**
 * Valida las variables de entorno requeridas y lanza un error descriptivo si
 * falta alguna o tiene un formato inválido. Debe llamarse una única vez al
 * arrancar el proceso, antes de conectar a MongoDB o de importar cualquier
 * módulo que dependa de estas variables (p. ej. encryption.utils.ts).
 */
export const loadEnv = (): Env => {
  const parsed = envSchema.safeParse({
    JWT_SECRET: process.env.JWT_SECRET,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    MONGO_URI: process.env.MONGO_URI,
    PUBLIC_URL: process.env.PUBLIC_URL,
    REDIS_URL: process.env.REDIS_URL,
  });

  if (!parsed.success) {
    const message = `Configuración de entorno inválida: ${formatIssues(parsed.error)}`;
    console.error(`❌ ${message}`);
    throw new Error(message);
  }

  return parsed.data;
};
