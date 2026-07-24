const RUC_REGEX = /^\d{10}001$/;

/**
 * Validates Ecuadorian RUC format: 13 digits ending in "001". Relocated from
 * the retired self-service /register flow (src/routes/auth.ts) — nothing
 * calls this yet, a later tenant-provisioning phase will.
 */
export const isValidRUC = (ruc: string): boolean => RUC_REGEX.test(ruc);
