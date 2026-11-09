export interface AppConfig {
  databaseUrl: string;
  jwtSecret: string;
  otpPepper: string;
  lotterySeedKey: Buffer; // 32 bytes, AES-256-GCM key for sealing lottery seeds until reveal
  exposeOtpInResponse: boolean; // development only — never in production
  isProduction: boolean;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export function loadConfig(): AppConfig {
  const isProduction = process.env.NODE_ENV === 'production';
  const key = Buffer.from(required('LOTTERY_SEED_KEY'), 'hex');
  if (key.length !== 32) throw new Error('LOTTERY_SEED_KEY must be 64 hex chars (32 bytes)');
  const jwtSecret = required('JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  const expose = process.env.DEV_EXPOSE_OTP === 'true';
  if (expose && isProduction) throw new Error('DEV_EXPOSE_OTP cannot be enabled in production');
  return {
    databaseUrl: required('DATABASE_URL'),
    jwtSecret,
    otpPepper: required('OTP_PEPPER'),
    lotterySeedKey: key,
    exposeOtpInResponse: expose,
    isProduction,
  };
}

export const CONFIG = Symbol('CONFIG');
