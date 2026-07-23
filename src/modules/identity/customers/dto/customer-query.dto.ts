import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { STATUS_ACCOUNT, TYPE_CUSTOMER } from '@generated/prisma/enums';
import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

export class CustomerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TYPE_CUSTOMER })
  @IsOptional()
  @IsEnum(TYPE_CUSTOMER)
  customerType?: TYPE_CUSTOMER;

  @ApiPropertyOptional({ enum: STATUS_ACCOUNT })
  @IsOptional()
  @IsEnum(STATUS_ACCOUNT)
  status?: STATUS_ACCOUNT;

  @ApiPropertyOptional({
    description: 'Search company, user, email, phone or document',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
