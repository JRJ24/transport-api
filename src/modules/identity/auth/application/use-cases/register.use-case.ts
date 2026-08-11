import { BadRequestException, Injectable } from '@nestjs/common';
import { ROLES, TYPE_CUSTOMER } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
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
    this.assertBusinessProfile(dto);

    const user = await this.usersService.createCustomerWithProfile({
      fullName: dto.fullName,
      email: dto.email,
      phone: dto.phone,
      password: dto.password,
      roles: [ROLES.CUSTOMER],
      profile: {
        customerType: dto.customerType,
        documentType: dto.documentType,
        documentNumber: dto.documentNumber,
        companyName: dto.companyName,
        billingEmail: dto.billingEmail,
      },
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

  private assertBusinessProfile(dto: RegisterDto): void {
    if (
      dto.customerType === TYPE_CUSTOMER.BUSINESS &&
      !dto.companyName?.trim()
    ) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Business customers must provide a company name',
      });
    }
  }
}
