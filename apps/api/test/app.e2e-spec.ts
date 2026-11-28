import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DependenciesService, type Readiness } from '../src/health/dependencies.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const check = jest.fn<Promise<Readiness>, []>();

  beforeEach(async () => {
    check.mockReset();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DependenciesService)
      .useValue({ check })
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer()).get('/').expect(200).expect('Hello World!');
  });

  it('/health/live (GET)', () => {
    return request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
  });

  it('/health/ready (GET) when both stores are up', () => {
    const result: Readiness = { status: 'ok', checks: { postgres: 'up', redis: 'up' } };
    check.mockResolvedValue(result);
    return request(app.getHttpServer()).get('/health/ready').expect(200, result);
  });

  it('/health/ready (GET) when Redis is down', () => {
    const result: Readiness = {
      status: 'unavailable',
      checks: { postgres: 'up', redis: 'down' },
    };
    check.mockResolvedValue(result);
    return request(app.getHttpServer()).get('/health/ready').expect(503, result);
  });

  afterEach(async () => {
    await app.close();
  });
});
