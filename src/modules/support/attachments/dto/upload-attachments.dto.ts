import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

/**
 * Campos de texto del multipart de POST /attachments/upload (los archivos van
 * en `files`). Con forbidNonWhitelisted cualquier otro campo da 400; los
 * limites son los de CreateAttachmentDto.
 */
export class UploadAttachmentsDto {
  @ApiPropertyOptional({ example: 'DeliveryProof' })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  entityType?: string;

  @ApiPropertyOptional({ example: 'uuid-or-external-id' })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  entityId?: string;
}
