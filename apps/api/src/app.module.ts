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
import { Mailer } from './auth/mailer.ts';
import { GamiyasController } from './gamiyas/gamiyas.controller.ts';
import { GamiyasService } from './gamiyas/gamiyas.service.ts';
import { InstallmentsController, InstallmentsService } from './installments/installments.ts';
import { HealthController } from './health.ts';
import { AiController, AiService } from './ai/ai.ts';
import { ChatService } from './chat/chat.service.ts';
import { ChatController } from './chat/chat.controller.ts';
import { AssistantService } from './assistant/assistant.ts';
import { FilesController, FilesService } from './files/files.ts';
import { NotesController, NotesService } from './notes/notes.ts';
import { PayoutsController, PayoutsService } from './payouts/payouts.ts';
import { PublicConfigController } from './public-config.ts';
import { OrderingController, OrderingService } from './ordering/ordering.ts';
import { MembershipController, MembershipService } from './gamiyas/membership.ts';
import { SubstituteController, SubstituteService } from './gamiyas/substitute.ts';
import { GoalsController, GoalsService } from './goals/goals.ts';
import { DirectInvitesController, DirectInvitesService } from './gamiyas/direct.ts';

@Module({})
export class AppModule implements NestModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        JwtModule.register({ secret: config.jwtSecret, signOptions: { algorithm: 'HS256' } }),
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
      ],
      controllers: [HealthController, PublicConfigController, AuthController, GamiyasController, InstallmentsController, AiController, ChatController, FilesController, NotesController, PayoutsController, OrderingController, MembershipController, SubstituteController, GoalsController, DirectInvitesController],
      providers: [
        { provide: CONFIG, useValue: config },
        Db, Audit, Mailer, AuthService, GamiyasService, InstallmentsService, AiService, ChatService, AssistantService, FilesService, NotesService, PayoutsService, OrderingService, MembershipService, SubstituteService, GoalsService, DirectInvitesService,
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
