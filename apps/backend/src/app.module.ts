import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TransportModule } from './modules/transport/transport.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { AIModule } from './modules/ai/ai.module';
import { PlannerModule } from './modules/planner/planner.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { AnalyticsMiddleware } from './modules/analytics/analytics.middleware';
import { ScheduleModule } from '@nestjs/schedule';
import { MlModule } from './modules/ml/ml.module';
// import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 60,
      },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    TransportModule,
    MarketplaceModule,
    AIModule,
    PlannerModule,
    ScheduleModule.forRoot(),
    FeedbackModule,
    AnalyticsModule,
    AlertsModule,
    MlModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AnalyticsMiddleware).forRoutes('*'); // Apply to all routes
  }
}
