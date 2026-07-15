import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAttachmentDto {
  @ApiProperty({ example: 'Order' })
  @IsString()
  @Length(2, 80)
  entityType!: string;

  @ApiProperty({ example: 'uuid-or-external-id' })
  @IsString()
  @Length(2, 120)
  entityId!: string;

  @ApiProperty({ example: 'photo.jpg' })
  @IsString()
  @MaxLength(180)
  fileName!: string;

  @ApiProperty({ example: 'https://storage.local/photo.jpg' })
  @IsString()
  @IsUrl({ require_tld: false })
  fileUrl!: string;

  @ApiProperty({ example: 1024 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fileSize!: number;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @MaxLength(120)
  mimeType!: string;
}
