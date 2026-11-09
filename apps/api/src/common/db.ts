import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { CONFIG, type AppConfig } from './config.ts';

// Return DATE columns as 'YYYY-MM-DD' strings (calendar dates, no timezone shifts).
pg.types.setTypeParser(1082, (v: string) => v);

export interface Queryable {
  query<T extends pg.QueryResultRow = any>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
}

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool: pg.Pool;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  }

  query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
    return this.pool.query<T>(text, params);
  }

  /** Run `fn` inside one SERIALIZABLE-safe transaction; deferred ledger/balance triggers fire at COMMIT. */
  async tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
