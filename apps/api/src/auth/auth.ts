import { Body, Controller, HttpCode, Inject, Injectable, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { CONFIG, type AppConfig } from '../common/config.ts';
import { Db, type Queryable } from '../common/db.ts';
import { Audit } from '../common/audit.ts';
import { AppError, CorrelationId, parseBody } from '../common/http.ts';
import { Public } from '../common/auth.guard.ts';

const OTP_TTL_MIN = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_WINDOW = 5; // per phone per 15 minutes
const REFRESH_TTL_DAYS = 30;

// Saudi mobile numbers in E.164: +9665XXXXXXXX
const phone = z.string().regex(/^\+9665\d{8}$/, 'must be a Saudi mobile number in E.164 format (+9665XXXXXXXX)');
const RequestSchema = z.object({ phone });
const RefreshSchema = z.object({ refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
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
      const { _rowId, ...tokens } = await this.issueTokens(c, user.id, user.phone_e164, randomUUID());
      return { ...tokens, user: { id: user.id, fullName: user.full_name, kycStatus: user.kyc_status } };
    });
  }

  private sha(token: string) { return createHash('sha256').update(token).digest('hex'); }

  /** Access JWT (15 min) + opaque refresh token (30 days). Only the refresh token's hash is stored. */
  private async issueTokens(c: Queryable, userId: string, phone: string, familyId: string) {
    const refreshToken = randomBytes(32).toString('base64url');
    const row = (await c.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(days => $4)) RETURNING id`,
      [userId, familyId, this.sha(refreshToken), REFRESH_TTL_DAYS])).rows[0];
    const accessToken = await this.jwt.signAsync({ sub: userId, phone, typ: 'access' }, { expiresIn: '15m', algorithm: 'HS256' });
    return { accessToken, tokenType: 'Bearer', expiresInSeconds: 900, refreshToken, refreshExpiresInSeconds: REFRESH_TTL_DAYS * 86400, _rowId: row.id as string };
  }

  /**
   * Rotation: each refresh token works once and is replaced. Presenting an already-rotated token means it was
   * copied (theft or replay): the whole family is revoked and the user must sign in again.
   */
  async refresh(token: string, correlationId: string) {
    return this.db.tx(async (c) => {
      const t = (await c.query(
        `SELECT r.*, u.phone_e164 FROM refresh_tokens r JOIN users u ON u.id = r.user_id WHERE r.token_hash = $1 FOR UPDATE OF r`, [this.sha(token)])).rows[0];
      if (!t) throw new AppError(401, 'REFRESH_INVALID', 'invalid refresh token');
      if (t.revoked_at) {
        await c.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [t.family_id]);
        await this.audit.log(c, { actorId: t.user_id, action: 'REFRESH_REUSE_DETECTED', entity: 'session', entityId: t.family_id, correlationId });
        await c.query('COMMIT'); await c.query('BEGIN'); // keep the family revocation even though the request fails
        throw new AppError(401, 'REFRESH_REUSED', 'session revoked for safety; please sign in again');
      }
      if (new Date(t.expires_at) <= new Date()) throw new AppError(401, 'REFRESH_EXPIRED', 'refresh token expired');
      const next = await this.issueTokens(c, t.user_id, t.phone_e164, t.family_id);
      await c.query(`UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1`, [t.id, next._rowId]);
      const { _rowId, ...out } = next;
      return out;
    });
  }

  async logout(token: string, correlationId: string) {
    const t = (await this.db.query(`SELECT user_id, family_id FROM refresh_tokens WHERE token_hash = $1`, [this.sha(token)])).rows[0];
    if (t) {
      await this.db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [t.family_id]);
      await this.audit.log(this.db, { actorId: t.user_id, action: 'LOGOUT', entity: 'session', entityId: t.family_id, correlationId });
    }
    return { loggedOut: true }; // same answer whether or not the token existed
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

  @Public() @Post('refresh') @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@Body() body: unknown, @CorrelationId() cid: string) {
    return this.auth.refresh(parseBody(RefreshSchema, body).refreshToken, cid);
  }

  @Public() @Post('logout') @HttpCode(200)
  logout(@Body() body: unknown, @CorrelationId() cid: string) {
    return this.auth.logout(parseBody(RefreshSchema, body).refreshToken, cid);
  }
}
