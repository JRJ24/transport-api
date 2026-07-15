import { PartialType } from '@nestjs/swagger';
import { CreateRateCardDto } from './create-rate-card.dto';

export class UpdateRateCardDto extends PartialType(CreateRateCardDto) {}
