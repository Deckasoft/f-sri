import { z } from 'zod';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const errorBodySchema = z.object({ message: z.string() }).partial();

const parseJsonSafely = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * Fetches `path`, validates the parsed JSON body against `schema`, and
 * throws `ApiError` on a non-2xx response or a body that doesn't match the
 * expected shape. Every call site gets a runtime-checked, typed result
 * instead of trusting the network response.
 */
export const apiRequest = async <T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  const body = await parseJsonSafely(response);

  if (!response.ok) {
    const parsedError = errorBodySchema.safeParse(body);
    const message =
      parsedError.success && parsedError.data.message
        ? parsedError.data.message
        : `Solicitud fallida (${response.status})`;
    throw new ApiError(message, response.status);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError('Respuesta inesperada del servidor', response.status);
  }
  return parsed.data;
};

export const withBearerToken = (token: string): HeadersInit => ({
  Authorization: `Bearer ${token}`,
});
