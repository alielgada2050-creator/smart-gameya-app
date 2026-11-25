import { Controller, Get, Inject } from '@nestjs/common';
import { CONFIG, type AppConfig } from './common/config.ts';
import { Public } from './common/auth.guard.ts';
import { COUNTRIES } from '../../../packages/financial-core/src/payout-methods.ts';
import { readFileSync } from 'node:fs';

/** The release this server runs (package.json): the Android and iOS apps compare it with their own to offer an update. */
const VERSION = (() => {
  for (const up of ['../package.json', '../../../../package.json']) { // from src/ when run as source, from dist/apps/api/src/ when built
    try { return JSON.parse(readFileSync(new URL(up, import.meta.url), 'utf8')).version as string; } catch { /* try the next */ }
  }
  return null;
})();

/** Non-secret settings the web app needs before sign-in. The Google client id is public by design. */
@Controller('api/v1/config')
export class PublicConfigController {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}
  @Public() @Get('public')
  get() {
    const enabled = Object.entries(COUNTRIES).filter(([, c]) => !!this.config.tierLimits?.[c.currency]).map(([k]) => k);
    return { googleClientId: this.config.google?.clientId ?? null, googleIosClientId: this.config.google?.iosClientId ?? null, phoneSignIn: this.config.phoneSignIn, emailSignIn: !!this.config.smtp || this.config.exposeOtpInResponse, circleCountries: enabled, model: 'A', version: VERSION,
      stores: { android: process.env.PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=sa.refers.jamiyati', ios: process.env.APP_STORE_URL || null } };
  }
}
