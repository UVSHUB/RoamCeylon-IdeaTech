// modules/feedback/feedback.module.ts

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FeedbackService } from './feedback.service';
import { FeedbackMappingService } from './feedback-mapping.service';
import { FeedbackRankingService } from './ranking.service';
import { BiasMonitorService } from './bias-monitor.service';
import { AggregationValidatorService } from './aggregation-validator.service';
import { TrendMonitoringService } from './trend-monitoring.service';

@Module({
  imports: [PrismaModule],
  providers: [
    FeedbackService,
    FeedbackMappingService,
    FeedbackRankingService,
    BiasMonitorService,
    AggregationValidatorService,
    TrendMonitoringService,
  ],
  exports: [
    FeedbackService,
    FeedbackMappingService,
    FeedbackRankingService,
    BiasMonitorService,
    AggregationValidatorService,
  ],
})
export class FeedbackModule {}
