import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { DeliveryProof, Signature } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { DeliveryProofsService } from './delivery-proofs.service';
import { CreateDeliveryProofDto } from './dto/create-delivery-proof.dto';
import { CreateSignatureDto } from './dto/create-signature.dto';
import { ValidateDeliveryProofDto } from './dto/validate-delivery-proof.dto';

@ApiTags('delivery-proofs')
@ApiBearerAuth()
@Controller('delivery-proofs')
export class DeliveryProofsController {
  constructor(private readonly service: DeliveryProofsService) {}

  @ApiOperation({ summary: 'List delivery proofs' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Get()
  list(@Query('orderId') orderId?: string): Promise<DeliveryProof[]> {
    return this.service.list(orderId);
  }

  @ApiOperation({ summary: 'Capture delivery proof' })
  @Roles(ROLES.DRIVER, ROLES.ADMIN, ROLES.OPERATOR)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDeliveryProofDto,
  ): Promise<DeliveryProof> {
    return this.service.create(user, dto);
  }

  @ApiOperation({ summary: 'Validate delivery proof' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Patch(':id/validate')
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ValidateDeliveryProofDto,
  ): Promise<DeliveryProof> {
    return this.service.validate(id, dto);
  }

  @ApiOperation({ summary: 'Add signature to delivery proof' })
  @Roles(ROLES.DRIVER, ROLES.ADMIN, ROLES.OPERATOR)
  @Post(':id/signatures')
  addSignature(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSignatureDto,
  ): Promise<Signature> {
    return this.service.addSignature(id, dto);
  }
}
