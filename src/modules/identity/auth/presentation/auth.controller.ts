import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AllowUnverifiedDriver } from '@/common/decorators/allow-unverified-driver.decorator';
import { Public } from '@/common/decorators/public.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { extractRequestContext } from '@/common/utils/request.util';
import { AuthService } from '../application/auth.service';
import type { AuthResult, AuthTokens } from '../domain/auth-result.interface';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Log in with email and password' })
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() request: Request): Promise<AuthResult> {
    return this.authService.login(dto, extractRequestContext(request));
  }

  @ApiOperation({ summary: 'Register a new customer account' })
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('register')
  register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
  ): Promise<AuthResult> {
    return this.authService.register(dto, extractRequestContext(request));
  }

  @ApiOperation({
    summary: 'Rotate the refresh token and get a new access token',
  })
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body() dto: RefreshTokenDto,
    @Req() request: Request,
  ): Promise<AuthTokens> {
    return this.authService.refresh(
      dto.refreshToken,
      extractRequestContext(request),
    );
  }

  @ApiOperation({
    summary: 'Log out this device (revokes the current session)',
  })
  @ApiBearerAuth()
  @AllowUnverifiedDriver()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.authService.logout(user, extractRequestContext(request));
  }

  @ApiOperation({ summary: 'Log out every device (revokes all sessions)' })
  @ApiBearerAuth()
  @AllowUnverifiedDriver()
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<{ revokedCount: number }> {
    return this.authService.logoutAll(user, extractRequestContext(request));
  }

  @ApiOperation({ summary: 'Get the authenticated principal' })
  @ApiBearerAuth()
  @AllowUnverifiedDriver()
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
