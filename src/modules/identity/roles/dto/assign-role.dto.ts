import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsUUID } from 'class-validator';
import { ROLES } from '@generated/prisma/enums';

export class AssignRoleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ enum: ROLES })
  @IsEnum(ROLES)
  role!: ROLES;
}
