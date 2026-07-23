import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Attachment } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import type { Request } from 'express';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { UploadedFile } from '@/common/middlewares/processFile';
import {
  AttachmentsService,
  type UploadedAttachment,
} from './attachments.service';
import { CreateAttachmentDto } from './dto/create-attachment.dto';

type UploadRequest = Request & {
  body: {
    uploadedFiles?: UploadedFile[];
    entityType?: string;
    entityId?: string;
  };
};

@ApiTags('attachments')
@ApiBearerAuth()
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly service: AttachmentsService) {}

  @ApiOperation({ summary: 'List attachments by entity' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Get()
  list(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
  ): Promise<Attachment[]> {
    return this.service.list(entityType, entityId);
  }

  @ApiOperation({ summary: 'Create attachment metadata' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAttachmentDto,
  ): Promise<Attachment> {
    return this.service.create(user, dto);
  }

  @ApiOperation({ summary: 'Upload files and optionally attach them to an entity' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Post('upload')
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: UploadRequest,
  ): Promise<UploadedAttachment[]> {
    return this.service.createFromUploadedFiles(
      user,
      req.body.uploadedFiles ?? [],
      req.body.entityType,
      req.body.entityId,
    );
  }
}
