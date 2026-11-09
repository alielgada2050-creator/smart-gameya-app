import 'reflect-metadata';
import { type DynamicModule, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CONFIG, type AppConfig } from './common/config.ts';
import { Db } from './common/db.ts';
import { Audit } from './common/audit.ts';
import { AuthGuard } from './common/auth.guard.ts';
import { CorrelationMiddleware, ErrorFilter } from './common/http.ts';
import { AuthController, AuthService } from './auth/auth.ts';
import { GamiyasController } from './gamiyas/gamiyas.controller.ts';
import { GamiyasService } from './gamiyas/gamiyas.service.ts';
import { InstallmentsController, InstallmentsService } from './installments/installments.ts';
import { HealthController } from './health.ts';

@Module({})
export class AppModule implements NestModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        JwtModule.register({ secret: config.jwtSecret, signOptions: { algorithm: 'HS256' } }),
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
      ],
      controllers: [HealthController, AuthController, GamiyasController, InstallmentsController],
      providers: [
        { provide: CONFIG, useValue: config },
        Db, Audit, AuthService, GamiyasService, InstallmentsService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*path');
  }
}
