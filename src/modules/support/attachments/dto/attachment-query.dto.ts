import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

/**
 * Query de GET /attachments. Antes eran dos @Query('x') sueltos: un
 * ?entityType=a&entityType=b llegaba como array a Prisma (500) y cualquier
 * otro parametro se ignoraba en silencio. Todas las apps (portal, clientes y
 * las dos de conductor) mandan solo estos dos, asi que forbidNonWhitelisted no
 * rompe a nadie. Mismos limites que CreateAttachmentDto.
 */
export class AttachmentQueryDto {
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
