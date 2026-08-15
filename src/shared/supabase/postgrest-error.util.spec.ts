import {
  isPostgrestError,
  isUniqueViolation,
  isForeignKeyViolation,
} from './postgrest-error.util';

describe('postgrest-error.util', () => {
  describe('isPostgrestError', () => {
    it('returns true for an object with a code property', () => {
      expect(isPostgrestError({ code: '23505' })).toBe(true);
    });

    it('returns false for null', () => {
      expect(isPostgrestError(null)).toBe(false);
    });

    it('returns false for a plain Error without a code', () => {
      expect(isPostgrestError(new Error('boom'))).toBe(false);
    });

    it('returns false for a primitive', () => {
      expect(isPostgrestError('not an object')).toBe(false);
    });
  });

  describe('isUniqueViolation', () => {
    it('returns true for SQLSTATE 23505', () => {
      expect(isUniqueViolation({ code: '23505' })).toBe(true);
    });

    it('returns false for a different code', () => {
      expect(isUniqueViolation({ code: '23503' })).toBe(false);
    });

    it('returns false for a non-PostgrestError value', () => {
      expect(isUniqueViolation(new Error('boom'))).toBe(false);
    });
  });

  describe('isForeignKeyViolation', () => {
    it('returns true for SQLSTATE 23503', () => {
      expect(isForeignKeyViolation({ code: '23503' })).toBe(true);
    });

    it('returns false for a different code', () => {
      expect(isForeignKeyViolation({ code: '23505' })).toBe(false);
    });

    it('returns false for a non-PostgrestError value', () => {
      expect(isForeignKeyViolation(null)).toBe(false);
    });
  });
});
