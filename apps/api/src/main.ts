import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';
import { CONFIG, loadConfig, type AppConfig } from './common/config.ts';

export async function createApp(config = loadConfig()) {
  const app = await NestFactory.create(AppModule.forRoot(config), { logger: ['error', 'warn'] });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableShutdownHooks();
  const web = process.env.WEB_DIST;
  if (web) {
    const express = (await import('express')).default;
    const { join } = await import('node:path');
    const http = app.getHttpAdapter().getInstance();
    http.use((_req: any, res: any, next: any) => {
      res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      next();
    });
    http.use(express.static(web, { index: 'index.html', maxAge: '1h' }));
    http.get(/^\/(?!api\/).*/, (_req: any, res: any) => res.sendFile(join(web, 'index.html')));
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
