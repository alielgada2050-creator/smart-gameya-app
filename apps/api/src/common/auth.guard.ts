import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppError } from './http.ts';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Global guard: every route requires a valid access token unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'missing bearer token');
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; phone: string; typ: string }>(token, { algorithms: ['HS256'] });
      if (p.typ !== 'access') throw new Error('wrong token type');
      req.user = { id: p.sub, phone: p.phone };
      return true;
    } catch {
      throw new AppError(401, 'UNAUTHENTICATED', 'invalid or expired token');
    }
  }
}
