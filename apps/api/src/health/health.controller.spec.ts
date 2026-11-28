import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DependenciesService, type Readiness } from './dependencies.service';
import { HealthController } from './health.controller';

const healthy: Readiness = { status: 'ok', checks: { postgres: 'up', redis: 'up' } };
const unhealthy: Readiness = { status: 'unavailable', checks: { postgres: 'down', redis: 'up' } };

describe('HealthController', () => {
  const check = jest.fn<Promise<Readiness>, []>();
  let controller: HealthController;

  beforeEach(async () => {
    check.mockReset();
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DependenciesService, useValue: { check } }],
    }).compile();
    controller = module.get(HealthController);
  });

  it('reports liveness without contacting dependencies', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
    expect(check).not.toHaveBeenCalled();
  });

  it('reports readiness when both stores are reachable', async () => {
    check.mockResolvedValue(healthy);
    await expect(controller.ready()).resolves.toEqual(healthy);
  });

  it('rejects readiness when a dependency fails', async () => {
    check.mockResolvedValue(unhealthy);
    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
