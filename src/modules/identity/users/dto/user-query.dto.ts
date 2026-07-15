import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { STATUS_ACCOUNT } from '@generated/prisma/enums';
import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

export class UserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search by name or email' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: STATUS_ACCOUNT })
  @IsOptional()
  @IsEnum(STATUS_ACCOUNT)
  status?: STATUS_ACCOUNT;
}
