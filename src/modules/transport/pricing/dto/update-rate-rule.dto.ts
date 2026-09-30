import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateRateRuleDto } from './create-rate-rule.dto';

/** Every price of a rule; the category it prices cannot change. */
export class UpdateRateRuleDto extends PartialType(
  OmitType(CreateRateRuleDto, ['vehicleCategoryId'] as const),
) {}
