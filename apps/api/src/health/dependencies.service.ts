import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';

type DependencyStatus = 'up' | 'down';
export type Readiness = {
  status: 'ok' | 'unavailable';
  checks: { postgres: DependencyStatus; redis: DependencyStatus };
};

@Injectable()
export class DependenciesService implements OnModuleDestroy {
  private readonly logger = new Logger(DependenciesService.name);
  private readonly pool?: Pool;
  private inFlight?: Promise<Readiness>;

  constructor() {
    const { POSTGRES_HOST, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD } = process.env;
    if (POSTGRES_HOST && POSTGRES_DB && POSTGRES_USER && POSTGRES_PASSWORD) {
      this.pool = new Pool({
        host: POSTGRES_HOST,
        port: Number(process.env.POSTGRES_PORT ?? 5432),
        database: POSTGRES_DB,
        user: POSTGRES_USER,
        password: POSTGRES_PASSWORD,
        max: 5,
        connectionTimeoutMillis: 1500,
        query_timeout: 1500,
        statement_timeout: 1500,
      });
      this.pool.on('error', () => this.logger.warn('PostgreSQL idle connection failed'));
    }
  }

  check(): Promise<Readiness> {
    this.inFlight ??= this.checkDependencies().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async checkDependencies(): Promise<Readiness> {
    const [postgres, redis] = await Promise.all([this.checkPostgres(), this.checkRedis()]);
    return {
      status: postgres === 'up' && redis === 'up' ? 'ok' : 'unavailable',
      checks: { postgres, redis },
    };
  }

  private async checkPostgres(): Promise<DependencyStatus> {
    if (!this.pool) return 'down';
    try {
      await this.pool.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<DependencyStatus> {
    const { REDIS_HOST, REDIS_PASSWORD } = process.env;
    if (!REDIS_HOST || !REDIS_PASSWORD) return 'down';

    const client = new Redis({
      host: REDIS_HOST,
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: REDIS_PASSWORD,
      lazyConnect: true,
      enableOfflineQueue: false,
      enableReadyCheck: false,
      connectTimeout: 1500,
      commandTimeout: 1500,
      socketTimeout: 3000,
      retryStrategy: () => null,
      maxRetriesPerRequest: 0,
    });

    try {
      await client.connect();
      return (await client.ping()) === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    } finally {
      client.disconnect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
