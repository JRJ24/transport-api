import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileInterceptor,
  type MulterModuleOptions,
} from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import {
  AccountService,
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  type EmailChangeResult,
} from './account.service';
import {
  ChangePasswordDto,
  ConfirmEmailChangeDto,
  RequestEmailChangeDto,
} from './dto/account.dto';

/**
 * Multer de POST users/me/avatar. Antes solo limitaba fileSize: busboy
 * aceptaba sin tope campos de texto (1 MB cada uno, en RAM) y archivos con
 * otro nombre de campo, y cualquier tipo llegaba al servicio ya leido en
 * memoria. El endpoint solo necesita el archivo 'file' (app-customers manda
 * solo eso), asi que:
 * - files 1 y fields 0: un segundo archivo o cualquier campo de texto es 400.
 * - parts 2: busboy avisa del tope de partes al ALCANZARLO (no al pasarlo) y
 *   Multer lo trata como error, asi que con 1 se rechazaria la propia foto.
 * - fileFilter con los mismos tipos y mensaje que AccountService.setAvatar,
 *   para cortar antes de bufferizar un archivo que igual daria 400.
 */
export const AVATAR_UPLOAD_OPTIONS: MulterModuleOptions = {
  limits: {
    fileSize: AVATAR_MAX_BYTES,
    files: 1,
    fields: 0,
    parts: 2,
  },
  fileFilter: (_req, file, cb) => {
    if (AVATAR_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    // HttpException: el interceptor la deja pasar tal cual (400 con el sobre
    // de error estandar) en vez de convertirla en un 500.
    cb(
      new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'The avatar must be a JPG, PNG or WebP image',
      }),
      false,
    );
  },
};

/** Self-service security for the signed-in user (customers, drivers, staff). */
@ApiTags('account')
@ApiBearerAuth()
@Controller()
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @ApiOperation({
    summary: 'Change my password (signs out my other devices)',
  })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ revokedSessions: number }> {
    return this.account.changePassword(
      user,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @ApiOperation({ summary: 'Start changing my email (sends a code)' })
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('users/me/email')
  @HttpCode(HttpStatus.OK)
  requestEmailChange(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestEmailChangeDto,
  ): Promise<EmailChangeResult> {
    return this.account.requestEmailChange(user, dto.newEmail, dto.password);
  }

  @ApiOperation({ summary: 'Confirm my new email with the emailed code' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('users/me/email/confirm')
  @HttpCode(HttpStatus.OK)
  confirmEmailChange(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmEmailChangeDto,
  ): Promise<EmailChangeResult> {
    return this.account.confirmEmailChange(user, dto.code);
  }

  @ApiOperation({ summary: 'Upload my profile photo (JPG, PNG or WebP, 2 MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @Post('users/me/avatar')
  @UseInterceptors(FileInterceptor('file', AVATAR_UPLOAD_OPTIONS))
  uploadAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ): Promise<{ avatarUrl: string }> {
    return this.account.setAvatar(user, file, req);
  }

  @ApiOperation({ summary: 'Remove my profile photo' })
  @Delete('users/me/avatar')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAvatar(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.account.removeAvatar(user);
  }
}
