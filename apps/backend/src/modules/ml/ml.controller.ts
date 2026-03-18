import { Controller, Post, Body, Get, Query, BadRequestException } from '@nestjs/common';
import { MlService } from './ml.service';
import { TrackBehaviorDto } from './dto/track-behavior.dto';

@Controller('api')
export class MlController {
  constructor(private readonly mlService: MlService) {}

  @Post('behavior/track')
  async trackBehavior(@Body() dto: TrackBehaviorDto) {
    return this.mlService.trackBehavior(dto);
  }

  @Get('recommendations/personalized')
  async getPersonalizedRecommendations(@Query('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    return this.mlService.getPersonalizedRecommendations(userId);
  }
}
