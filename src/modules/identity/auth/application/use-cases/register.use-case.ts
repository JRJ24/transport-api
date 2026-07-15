import { Injectable } from '@nestjs/common';
import { ROLES } from '@generated/prisma/enums';
import type { RequestContext } from '@/common/interfaces/request-context.interface';
import { UsersService } from '../../../users/users.service';
import type { AuthResult } from '../../domain/auth-result.interface';
import type { RegisterDto } from '../../presentation/dto/register.dto';
import { AUTH_AUDIT_ACTIONS, AuthAuditService } from '../auth-audit.service';
import { AuthSessionIssuer } from '../auth-session.issuer';

@Injectable()
export class RegisterUseCase {
  constructor(
    private readonly usersService: UsersService,
    private readonly sessionIssuer: AuthSessionIssuer,
    private readonly audit: AuthAuditService,
  ) {}

  /**
   * Public self-registration always creates a CUSTOMER. Operational accounts
   * (ADMIN/OPERATOR/DRIVER) are provisioned from the TMS, never here.
   */
  async execute(
    dto: RegisterDto,
    context: RequestContext,
  ): Promise<AuthResult> {
    const user = await this.usersService.create({
      fullName: dto.fullName,
      email: dto.email,
      phone: dto.phone,
      password: dto.password,
      roles: [ROLES.CUSTOMER],
    });

    await this.audit.record({
      action: AUTH_AUDIT_ACTIONS.REGISTER,
      actorUserId: user.id,
      entityType: 'User',
      entityId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return this.sessionIssuer.issue(user, dto, context);
  }
}
