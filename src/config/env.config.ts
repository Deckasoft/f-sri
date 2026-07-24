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
  });

  if (!parsed.success) {
    const message = `Configuración de entorno inválida: ${formatIssues(parsed.error)}`;
    console.error(`❌ ${message}`);
    throw new Error(message);
  }

  return parsed.data;
};
