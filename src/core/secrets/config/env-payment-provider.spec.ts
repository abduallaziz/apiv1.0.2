import { envValidationSchema } from './env.validation';

const base = {
  SUPABASE_URL: 'https://abcdefghij1234567890.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
  JWT_SECRET: 'j'.repeat(40),
  REDIS_URL: 'redis://localhost:6379',
};
const validate = (extra: Record<string, string>) =>
  envValidationSchema.validate({ ...base, ...extra }, { allowUnknown: true });

describe('PAYMENT_PROVIDER production guard (T3)', () => {
  it('refuses mock in production by default', () => {
    const { error } = validate({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock' });
    expect(error).toBeDefined();
  });
  it('refuses an unset provider (defaults to mock) in production', () => {
    expect(validate({ NODE_ENV: 'production' }).error).toBeDefined();
  });
  it('allows mock in production only with the explicit opt-in', () => {
    expect(
      validate({
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'mock',
        ALLOW_MOCK_PAYMENT_IN_PRODUCTION: 'true',
      }).error,
    ).toBeUndefined();
  });
  it('mock stays fine in development/test', () => {
    expect(validate({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'mock' }).error).toBeUndefined();
    expect(validate({ NODE_ENV: 'test' }).error).toBeUndefined();
  });
});
