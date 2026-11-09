import { Body, Controller, HttpCode, Inject, Injectable, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { CONFIG, type AppConfig } from '../common/config.ts';
import { Db } from '../common/db.ts';
import { Audit } from '../common/audit.ts';
import { AppError, CorrelationId, parseBody } from '../common/http.ts';
import { Public } from '../common/auth.guard.ts';

const OTP_TTL_MIN = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_WINDOW = 5; // per phone per 15 minutes

// Saudi mobile numbers in E.164: +9665XXXXXXXX
const phone = z.string().regex(/^\+9665\d{8}$/, 'must be a Saudi mobile number in E.164 format (+9665XXXXXXXX)');
const RequestSchema = z.object({ phone });
const VerifySchema = z.object({ phone, code: z.string().regex(/^\d{6}$/), fullName: z.string().trim().min(2).max(100).optional() });

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly audit: Audit,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private hash(code: string) {
    return createHash('sha256').update(`${code}:${this.config.otpPepper}`).digest('hex');
  }

  async requestOtp(phoneNumber: string, correlationId: string) {
    const { rows } = await this.db.query<{ n: string }>(
      "SELECT count(*) AS n FROM otp_challenges WHERE phone_e164=$1 AND created_at > now() - interval '15 minutes'", [phoneNumber]);
    if (Number(rows[0].n) >= OTP_MAX_PER_WINDOW) throw new AppError(429, 'RATE_LIMITED', 'too many codes requested; try later');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.query(
      `INSERT INTO otp_challenges (phone_e164, code_hash, expires_at) VALUES ($1,$2, now() + interval '${OTP_TTL_MIN} minutes')`,
      [phoneNumber, this.hash(code)]);
    await this.audit.log(this.db, { actorId: null, action: 'OTP_REQUESTED', entity: 'phone', entityId: phoneNumber.slice(0, 6) + '****', correlationId });
    // Production: hand `code` to the SMS provider adapter here. Never log it.
    return { sent: true, expiresInSeconds: OTP_TTL_MIN * 60, ...(this.config.exposeOtpInResponse ? { devCode: code } : {}) };
  }

  async verifyOtp(input: z.infer<typeof VerifySchema>, correlationId: string) {
    return this.db.tx(async (c) => {
      const { rows } = await c.query(
        `SELECT id, code_hash, attempts FROM otp_challenges
         WHERE phone_e164=$1 AND consumed_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [input.phone]);
      const ch = rows[0];
      if (!ch || ch.attempts >= OTP_MAX_ATTEMPTS) throw new AppError(401, 'OTP_INVALID', 'code invalid or expired');
      const ok = timingSafeEqual(Buffer.from(ch.code_hash, 'hex'), Buffer.from(this.hash(input.code), 'hex'));
      if (!ok) {
        await c.query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id=$1', [ch.id]);
        // commit the attempt counter even though the request fails
        await c.query('COMMIT'); await c.query('BEGIN');
        throw new AppError(401, 'OTP_INVALID', 'code invalid or expired');
      }
      await c.query('UPDATE otp_challenges SET consumed_at = now() WHERE id=$1', [ch.id]);
      const user = (await c.query(
        `INSERT INTO users (phone_e164, full_name) VALUES ($1, $2)
         ON CONFLICT (phone_e164) DO UPDATE SET full_name = COALESCE($3, users.full_name)
         RETURNING id, phone_e164, full_name, kyc_status, (xmax = 0) AS created`,
        [input.phone, input.fullName ?? 'عضو جديد', input.fullName ?? null])).rows[0];
      await this.audit.log(c, { actorId: user.id, action: user.created ? 'USER_REGISTERED' : 'USER_LOGIN', entity: 'user', entityId: user.id, correlationId });
      const accessToken = await this.jwt.signAsync({ sub: user.id, phone: user.phone_e164, typ: 'access' }, { expiresIn: '15m', algorithm: 'HS256' });
      return { accessToken, tokenType: 'Bearer', expiresInSeconds: 900, user: { id: user.id, fullName: user.full_name, kycStatus: user.kyc_status } };
    });
  }
}

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Post('otp/request') @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  request(@Body() body: unknown, @CorrelationId() cid: string) {
    return this.auth.requestOtp(parseBody(RequestSchema, body).phone, cid);
  }

  @Public() @Post('otp/verify') @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(@Body() body: unknown, @CorrelationId() cid: string) {
    return this.auth.verifyOtp(parseBody(VerifySchema, body), cid);
  }
}
