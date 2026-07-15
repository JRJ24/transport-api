import { PartialType } from '@nestjs/swagger';
import { CreateVehicleCategoryDto } from './create-vehicle-category.dto';

export class UpdateVehicleCategoryDto extends PartialType(
  CreateVehicleCategoryDto,
) {}
