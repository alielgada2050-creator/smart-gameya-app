import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';
import { loadConfig } from './common/config.ts';

export async function createApp(config = loadConfig()) {
  const app = await NestFactory.create(AppModule.forRoot(config), { logger: ['error', 'warn'] });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableShutdownHooks();
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3000));
  console.log(`Smart Gam'eya API listening on :${process.env.PORT ?? 3000}`);
}
