import { Controller, Get, Inject } from '@nestjs/common';
import { CONFIG, type AppConfig } from './common/config.ts';
import { Public } from './common/auth.guard.ts';
import { COUNTRIES } from '../../../packages/financial-core/src/payout-methods.ts';

/** Non-secret settings the web app needs before sign-in. The Google client id is public by design. */
@Controller('api/v1/config')
export class PublicConfigController {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}
  @Public() @Get('public')
  get() {
    const enabled = Object.entries(COUNTRIES).filter(([, c]) => !!this.config.tierLimits?.[c.currency]).map(([k]) => k);
    return { googleClientId: this.config.google?.clientId ?? null, circleCountries: enabled, model: 'A' };
  }
}
