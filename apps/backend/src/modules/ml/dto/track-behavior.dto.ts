import { IsString, IsNotEmpty, IsOptional, IsIn, IsObject } from 'class-validator';
import { EVENT_TYPES } from '../constants/event-types';

export class TrackBehaviorDto {
  @IsString()
  @IsNotEmpty()
  user_id: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(EVENT_TYPES)
  event_type: string;

  @IsString()
  @IsOptional()
  item_id?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
