import { chainFromEnv, type ProviderChain } from '../../../../packages/ai-core/src/providers.ts';
import { TIER_LIMITS, limitsFromEnv, type TierLimits } from '../../../../packages/financial-core/src/tiers.ts';

export interface AppConfig {
  databaseUrl: string;
  jwtSecret: string;
  otpPepper: string;
  lotterySeedKey: Buffer; // 32 bytes, AES-256-GCM key for sealing lottery seeds until reveal
  exposeOtpInResponse: boolean; // development only — never in production
  isProduction: boolean;
  ai: { chain: ProviderChain; skipped: string[] }; // free-tier provider chain; empty chain → deterministic template
  payoutKey?: Buffer; // 32 bytes, AES-256-GCM key for payout account values (IBAN, wallet numbers)
  uploadDir?: string; // private directory for receipts and promissory notes (S3-compatible bucket in production)
  tierLimits?: Record<string, TierLimits | undefined>;
  google?: { clientId: string; iosClientId?: string; jwksUrl: string; issuers: string[] }; // Sign in with Google (ID token); the iOS app's client id is a second accepted audience
  platformAdminPhones?: string[]; // bootstrap platform admins (E.164); everyone else is a normal user
  platformAdminEmails?: string[]; // same, by verified Google email (lower-case)
  phoneSignIn: boolean; // mobile-code sign-in; off until an SMS provider delivers codes (dev exposes the code instead)
  remindersEveryMinutes?: number; // 0 = only on demand
  corsOrigins?: string[]; // origins of the Android/iOS apps (and any separate web front end) allowed to call the API
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

function key32(name: string): Buffer {
  const k = Buffer.from(required(name), 'hex');
  if (k.length !== 32) throw new Error(`${name} must be 64 hex chars (32 bytes)`);
  return k;
}

export function loadConfig(): AppConfig {
  const isProduction = process.env.NODE_ENV === 'production';
  const jwtSecret = required('JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  const expose = process.env.DEV_EXPOSE_OTP === 'true';
  if (expose && isProduction) throw new Error('DEV_EXPOSE_OTP cannot be enabled in production');
  const clientId = process.env.GOOGLE_CLIENT_ID;
  return {
    databaseUrl: required('DATABASE_URL'),
    jwtSecret,
    otpPepper: required('OTP_PEPPER'),
    lotterySeedKey: key32('LOTTERY_SEED_KEY'),
    exposeOtpInResponse: expose,
    isProduction,
    ai: chainFromEnv(process.env),
    payoutKey: key32('PAYOUT_ENCRYPTION_KEY'),
    uploadDir: required('UPLOAD_DIR'),
    tierLimits: {
      ...TIER_LIMITS,
      EGP: limitsFromEnv('EGP', process.env.TIER_LIMITS_EGP),
      AED: limitsFromEnv('AED', process.env.TIER_LIMITS_AED),
    },
    google: clientId ? { clientId, iosClientId: process.env.GOOGLE_IOS_CLIENT_ID?.trim() || undefined, jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs', issuers: ['accounts.google.com', 'https://accounts.google.com'] } : undefined,
    platformAdminPhones: (process.env.PLATFORM_ADMIN_PHONES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    platformAdminEmails: (process.env.PLATFORM_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    // No SMS provider is integrated yet, so outside development the mobile code cannot reach anyone: Google is the sign-in.
    phoneSignIn: expose,
    remindersEveryMinutes: Number(process.env.REMINDERS_EVERY_MINUTES ?? 60),
    // Capacitor serves the bundled app from https://localhost (Android) and capacitor://localhost (iOS).
    corsOrigins: (process.env.CORS_ORIGINS ?? 'https://localhost,capacitor://localhost').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

export const CONFIG = Symbol('CONFIG');
