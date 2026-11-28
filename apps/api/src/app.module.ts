import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { PartyModule } from './party/party.module';

@Module({
  imports: [HealthModule, PartyModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
