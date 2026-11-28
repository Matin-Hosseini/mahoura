import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DependenciesService, type Readiness } from './dependencies.service';

@Controller('health')
export class HealthController {
  constructor(private readonly dependencies: DependenciesService) {}

  @Get(['', 'live'])
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<Readiness> {
    const result = await this.dependencies.check();
    if (result.status !== 'ok') {
      throw new ServiceUnavailableException(result);
    }
    return result;
  }
}
