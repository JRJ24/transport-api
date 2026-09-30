import {
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
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import {
  AccountService,
  AVATAR_MAX_BYTES,
  type EmailChangeResult,
} from './account.service';
import {
  ChangePasswordDto,
  ConfirmEmailChangeDto,
  RequestEmailChangeDto,
} from './dto/account.dto';

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
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: AVATAR_MAX_BYTES } }),
  )
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
