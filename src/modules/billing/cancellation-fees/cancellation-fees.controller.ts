import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { EvidenceAccessService } from '@/modules/support/evidence-access/evidence-access.service';
import { CancellationFeesService } from './cancellation-fees.service';

@ApiTags('cancellation-fees')
@ApiBearerAuth()
@Controller('cancellation-fees')
export class CancellationFeesController {
  constructor(
    private readonly service: CancellationFeesService,
    private readonly access: EvidenceAccessService,
  ) {}

  /**
   * El calculo devuelve el cargo y el reembolso, es decir, el total de la
   * orden: cualquier cliente lo leia de una orden ajena con solo el id. Misma
   * regla de "orden propia" que la evidencia, antes de buscar la orden (un id
   * ajeno y uno inexistente dan el mismo 403; staff sigue viendo el 404).
   */
  @ApiOperation({ summary: 'Calculate internal/mock cancellation fee' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER)
  @Get('orders/:orderId')
  async calculate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    await this.access.assertOrderAccess(user, orderId, {
      message: 'You cannot access this order',
    });
    return this.service.calculate(orderId);
  }
}
