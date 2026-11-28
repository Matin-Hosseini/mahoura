import { Module } from '@nestjs/common';
import { DependenciesService } from './dependencies.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  providers: [DependenciesService],
})
export class HealthModule {}
