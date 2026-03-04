import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AlertsService } from './alerts.service';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [ScheduleModule.forRoot(), AnalyticsModule],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
