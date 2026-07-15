import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, IsUrl } from 'class-validator';
import {
  DOCUMENT_TYPE_VEHICLE,
  VERIFICATION_STATUS_DOCS,
} from '@generated/prisma/enums';

export class CreateVehicleDocumentDto {
  @ApiProperty({ enum: DOCUMENT_TYPE_VEHICLE })
  @IsEnum(DOCUMENT_TYPE_VEHICLE)
  documentType!: DOCUMENT_TYPE_VEHICLE;

  @ApiProperty({ example: 'https://storage.local/document.pdf' })
  @IsString()
  @IsUrl({ require_tld: false })
  fileUrl!: string;

  @ApiProperty({ example: '2027-12-31T00:00:00.000Z' })
  @Type(() => Date)
  @IsDate()
  expirationDate!: Date;

  @ApiPropertyOptional({ enum: VERIFICATION_STATUS_DOCS })
  @IsOptional()
  @IsEnum(VERIFICATION_STATUS_DOCS)
  status?: VERIFICATION_STATUS_DOCS;
}
