import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { STATUS_ACCOUNT } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { RequestContext } from '@/common/interfaces/request-context.interface';
import { DUMMY_PASSWORD_HASH, verifyPassword } from '@/common/utils/hash.util';
import { UsersService } from '../../../users/users.service';
import type { AuthResult } from '../../domain/auth-result.interface';
import type { LoginDto } from '../../presentation/dto/login.dto';
import { AUTH_AUDIT_ACTIONS, AuthAuditService } from '../auth-audit.service';
import { AuthSessionIssuer } from '../auth-session.issuer';

@Injectable()
export class LoginUseCase {
  constructor(
    private readonly usersService: UsersService,
    private readonly sessionIssuer: AuthSessionIssuer,
    private readonly audit: AuthAuditService,
  ) {}

  async execute(dto: LoginDto, context: RequestContext): Promise<AuthResult> {
    const user = await this.usersService.findByEmailWithRoles(dto.email);

    // Compare against a dummy hash when the user does not exist so response
    // timing does not reveal which emails are registered.
    const passwordMatches = await verifyPassword(
      dto.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordMatches) {
      await this.audit.record({
        action: AUTH_AUDIT_ACTIONS.LOGIN_FAILED,
        actorUserId: user?.id,
        entityType: 'User',
        entityId: user?.id ?? 'unknown',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { email: dto.email },
      });

      throw new UnauthorizedException({
        code: ERROR_CODES.INVALID_CREDENTIALS,
        message: 'Invalid credentials',
      });
    }

    if (user.status === STATUS_ACCOUNT.BLOCKED) {
      throw new ForbiddenException({
        code: ERROR_CODES.ACCOUNT_BLOCKED,
        message: 'Account is blocked',
      });
    }

    if (user.status !== STATUS_ACCOUNT.ACTIVE) {
      throw new ForbiddenException({
        code: ERROR_CODES.ACCOUNT_INACTIVE,
        message: 'Account is not active',
      });
    }

    const result = await this.sessionIssuer.issue(user, dto, context);

    await this.usersService.updateLastLogin(user.id);

    await this.audit.record({
      action: AUTH_AUDIT_ACTIONS.LOGIN,
      actorUserId: user.id,
      entityType: 'UserSession',
      entityId: result.sessionId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { platform: dto.platform, deviceId: dto.deviceId },
    });

    return result;
  }
}
