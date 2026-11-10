import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';
import { CONFIG, loadConfig, type AppConfig } from './common/config.ts';

export async function createApp(config = loadConfig()) {
  const app = await NestFactory.create(AppModule.forRoot(config), { logger: ['error', 'warn'] });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableShutdownHooks();
  // The native apps call the API cross-origin with a bearer token (no cookies), so credentials stay off.
  const origins = config.corsOrigins ?? [];
  if (origins.length) {
    app.enableCors({
      origin: (origin: string | undefined, cb: (e: Error | null, ok?: boolean) => void) => cb(null, !origin || origins.includes(origin)),
      methods: ['GET', 'POST'], allowedHeaders: ['content-type', 'authorization', 'x-correlation-id'], exposedHeaders: ['x-correlation-id'],
      credentials: false, maxAge: 600,
    });
  }
  const web = process.env.WEB_DIST;
  if (web) {
    const express = (await import('express')).default;
    const { join } = await import('node:path');
    const http = app.getHttpAdapter().getInstance();
    http.use((_req: any, res: any, next: any) => {
      // Google Identity Services (sign-in button) is the only third-party script, and only from accounts.google.com.
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com/gsi/; connect-src 'self' https://accounts.google.com/gsi/; style-src 'self' https://accounts.google.com/gsi/style; font-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      next();
    });
    // The shell entry points must revalidate so an update reaches installed apps; hashed assets are immutable.
    http.use(express.static(web, {
      index: 'index.html',
      setHeaders: (res: any, path: string) => {
        if (/(index\.html|sw\.js|manifest\.webmanifest)$/.test(path)) res.setHeader('Cache-Control', 'no-cache');
        else if (path.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'public, max-age=3600');
      },
    }));
    http.get(/^\/(?!api\/).*/, (_req: any, res: any) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(join(web, 'index.html')); });
  }
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3000));
  const cfg = app.get(CONFIG) as AppConfig;
  console.log(`Smart Gam'eya API listening on :${process.env.PORT ?? 3000}`);
  console.log(`AI providers: ${cfg.ai.chain.providers.map((p) => `${p.name}/${p.model}`).join(' → ') || 'none'} → template${cfg.ai.skipped.length ? ` (skipped: ${cfg.ai.skipped.join(', ')})` : ''}`);
}
