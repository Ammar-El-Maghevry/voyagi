import {
  EnvironmentVariables,
  NodeEnvironment,
  validateEnvironment,
} from './env.validation';

describe('validateEnvironment', () => {
  it('accepts a valid, complete environment', () => {
    const result = validateEnvironment({
      NODE_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'info',
    });

    expect(result).toBeInstanceOf(EnvironmentVariables);
    expect(result.NODE_ENV).toBe(NodeEnvironment.Production);
    expect(result.PORT).toBe(8080);
  });

  it('applies defaults when optional values are missing', () => {
    const result = validateEnvironment({});

    expect(result.NODE_ENV).toBe(NodeEnvironment.Development);
    expect(result.PORT).toBe(3000);
  });

  it('fails fast on an invalid NODE_ENV', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'staging' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('fails fast on an out-of-range PORT', () => {
    expect(() => validateEnvironment({ PORT: '70000' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('fails fast on an unsupported LOG_LEVEL', () => {
    expect(() => validateEnvironment({ LOG_LEVEL: 'verbose' })).toThrow(
      /LOG_LEVEL/,
    );
  });
});
