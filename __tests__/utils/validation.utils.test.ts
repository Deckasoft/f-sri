import { isValidRUC } from '../../src/utils/validation.utils';

describe('validation.utils', () => {
  describe('isValidRUC', () => {
    it('accepts a well-formed RUC (13 digits ending in 001)', () => {
      expect(isValidRUC('1234567890001')).toBe(true);
    });

    it('rejects a RUC not ending in 001', () => {
      expect(isValidRUC('1234567890002')).toBe(false);
    });

    it('rejects a RUC with the wrong length', () => {
      expect(isValidRUC('123')).toBe(false);
      expect(isValidRUC('12345678900010')).toBe(false);
    });

    it('rejects non-numeric input', () => {
      expect(isValidRUC('123456789000a')).toBe(false);
    });

    it('rejects an empty string', () => {
      expect(isValidRUC('')).toBe(false);
    });
  });
});
