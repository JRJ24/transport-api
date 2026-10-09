import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Attachment } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import type { Request } from 'express';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import {
  AttachmentsService,
  type UploadedAttachment,
} from './attachments.service';
import { AttachmentQueryDto } from './dto/attachment-query.dto';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import { UploadAttachmentsDto } from './dto/upload-attachments.dto';

@ApiTags('attachments')
@ApiBearerAuth()
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly service: AttachmentsService) {}

  @ApiOperation({ summary: 'List attachments by entity' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AttachmentQueryDto,
  ): Promise<Attachment[]> {
    return this.service.list(user, query.entityType, query.entityId);
  }

  // Solo staff: con un fileUrl arbitrario un conductor cerraba la entrega sin
  // subir nada, o con la foto publica de otro conductor (ver
  // AttachmentsService.create). Conductores y clientes usan /upload.
  @ApiOperation({ summary: 'Create attachment metadata (staff only)' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAttachmentDto,
  ): Promise<Attachment> {
    return this.service.create(user, dto);
  }

  // AnyFilesInterceptor (opciones en AttachmentsModule) y no un middleware:
  // los interceptores corren despues de los guards, asi que sin token o sin
  // rol el multipart ni se lee. Acepta cualquier nombre de campo, como el
  // multer.any() anterior; las apps usan 'files'.
  @ApiOperation({
    summary:
      'Upload files attached to an entity (entityType + entityId; only staff may omit them)',
  })
  @ApiConsumes('multipart/form-data')
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Post('upload')
  @UseInterceptors(AnyFilesInterceptor())
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() dto: UploadAttachmentsDto,
    @Req() req: Request,
  ): Promise<UploadedAttachment[]> {
    return this.service.upload(user, files, dto, req);
  }
}
