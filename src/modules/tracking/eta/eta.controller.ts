import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { EvidenceAccessService } from '@/modules/support/evidence-access/evidence-access.service';
import { EtaService } from './eta.service';

/**
 * El ETA (duracion, minutos transcurridos y ultimo GPS) se servia a cualquier
 * cliente o conductor con el id de la orden. Misma regla que la evidencia, y
 * antes de buscar la orden: asi un id ajeno y uno que no existe dan el mismo
 * 403 (staff sigue viendo el 404 de una orden inexistente).
 */
const ORDER_ACCESS_DENIED = 'You cannot access this order';

@ApiTags('eta')
@ApiBearerAuth()
@Controller('eta')
export class EtaController {
  constructor(
    private readonly service: EtaService,
    private readonly access: EvidenceAccessService,
  ) {}

  @ApiOperation({ summary: 'Get internal/mock ETA for an order' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Get('orders/:orderId')
  async forOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    await this.access.assertOrderAccess(user, orderId, {
      message: ORDER_ACCESS_DENIED,
    });
    return this.service.forOrder(orderId);
  }
}
