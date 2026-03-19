import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { MlService } from './ml.service';
import { TrackBehaviorDto } from './dto/track-behavior.dto';
import {
  MlPredictionService,
  MLPredictionRequest,
} from './services/mlPrediction.service';

@Controller('api')
export class MlController {
  constructor(
    private readonly mlService: MlService,
    private readonly mlPredictionService: MlPredictionService,
  ) {}

  @Post('ml/recommendations')
  async getMLRecommendations(@Body() body: MLPredictionRequest) {
    const result = await this.mlPredictionService.getMLRecommendations(body);
    if (!result) return { recommendations: [] };
    return result;
  }

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
