import {
  ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Injectable, type NestMiddleware,
  createParamDecorator, type ExecutionContext,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { z, type ZodType } from 'zod';

/** Domain error with a stable machine-readable code. */
export class AppError extends HttpException {
  constructor(status: number, readonly code: string, message: string) {
    super({ code, message }, status);
  }
}
export const notFound = (what = 'resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'not allowed') => new AppError(403, 'FORBIDDEN', msg);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);
export const badRequest = (code: string, msg: string) => new AppError(400, code, msg);

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.header('x-correlation-id');
    const id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    (req as any).correlationId = id;
    res.setHeader('x-correlation-id', id);
    next();
  }
}

/** Standard error envelope: { error: { code, message, correlationId } }. Internal errors never leak details. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const correlationId = (req as any).correlationId;
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL';
    let message = 'internal error';
    if (err instanceof AppError) {
      status = err.getStatus(); code = err.code; message = err.message;
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      code = status === 429 ? 'RATE_LIMITED' : status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR';
      message = err.message;
    } else if ((err as any)?.code === '23505') {
      status = 409; code = 'DUPLICATE'; message = 'duplicate request';
    } else {
      console.error(JSON.stringify({ level: 'error', correlationId, err: String((err as any)?.stack ?? err) }));
    }
    res.status(status).json({ error: { code, message, correlationId } });
  }
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw badRequest('VALIDATION_FAILED', msg);
  }
  return r.data;
}

export const uuid = z.string().uuid();
export function parseId(v: string): string {
  if (!uuid.safeParse(v).success) throw notFound();
  return v;
}

export interface AuthUser { id: string; phone: string | null }
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string | null => ctx.switchToHttp().getRequest().ip ?? null);
export const CorrelationId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => ctx.switchToHttp().getRequest().correlationId);
/** IP and device of the request, kept with signed pledges as evidence. */
export const SignerInfo = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const r = ctx.switchToHttp().getRequest();
  return { ip: (r.ip as string | undefined) ?? null, userAgent: (r.headers?.['user-agent'] as string | undefined) ?? null };
});
