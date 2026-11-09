import { Controller, Get } from '@nestjs/common';
import { Public } from './common/auth.guard.ts';
import { Db } from './common/db.ts';

@Controller('api/v1/health')
export class HealthController {
  constructor(private readonly db: Db) {}
  @Public() @Get()
  async health() {
    await this.db.query('SELECT 1');
    return { status: 'ok', model: 'A — organization tool; the platform never holds member funds' };
  }
}
