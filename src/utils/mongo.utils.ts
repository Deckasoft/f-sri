/**
 * Mongo raises E11000 for a unique-index violation. Routes map it to 409
 * (the caller asked for something that already exists) rather than letting
 * it fall through to a generic 500, which tells the caller nothing about
 * which constraint they hit.
 */
export const isDuplicateKeyError = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && 'code' in err && err.code === 11000;
