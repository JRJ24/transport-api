import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { OrderEvent } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { EvidenceAccessService } from '@/modules/support/evidence-access/evidence-access.service';
import { CreateOrderEventDto } from './dto/create-order-event.dto';
import { OrderEventsService } from './order-events.service';

const ORDER_ACCESS_DENIED = 'You cannot access this order';
const ORDER_EVENT_WRITE_DENIED = 'You cannot add events to this order';

@ApiTags('order-events')
@ApiBearerAuth()
@Controller('order-events')
export class OrderEventsController {
  constructor(
    private readonly service: OrderEventsService,
    private readonly access: EvidenceAccessService,
  ) {}

  /**
   * Antes cualquier conductor escribia en la bitacora de cualquier orden
   * (ARRIVED, DELIVERED...) con solo mandar su id, y esa bitacora es la que
   * leen el cliente y el portal. Ahora solo staff o el conductor que lleva la
   * orden: asignacion ACCEPTED (el "Llegue" de la app sale con la orden en
   * curso) o COMPLETED (justo despues de entregar). Sin cliente: el rol ya no
   * entra, y un usuario cliente+conductor no escribe en su propia orden
   * como si la llevara.
   */
  @ApiOperation({ summary: 'Create order event' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.DRIVER)
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderEventDto,
  ): Promise<OrderEvent> {
    await this.access.assertOrderAccess(user, dto.orderId, {
      mode: 'write',
      allowCustomer: false,
      message: ORDER_EVENT_WRITE_DENIED,
    });
    return this.service.create(user, dto);
  }

  /**
   * La linea de tiempo filtraba solo por orderId: cualquier cliente o
   * conductor leia la de una orden ajena. Misma regla que la evidencia
   * (staff, conductor con asignacion PENDING/ACCEPTED/COMPLETED, cliente
   * dueno) y mismo 403 exista o no la orden.
   */
  @ApiOperation({ summary: 'List order events' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Get('orders/:orderId')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<OrderEvent[]> {
    await this.access.assertOrderAccess(user, orderId, {
      message: ORDER_ACCESS_DENIED,
    });
    return this.service.list(orderId);
  }
}
