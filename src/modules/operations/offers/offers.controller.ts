import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { DriverOffer, OrderAssignment } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { RejectOfferDto } from './dto/respond-offer.dto';
import { OffersService } from './offers.service';

@ApiTags('offers')
@ApiBearerAuth()
@Controller('offers')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @ApiOperation({ summary: 'Pending dispatch offers for the current driver' })
  @Roles(ROLES.DRIVER)
  @Get('me')
  mine(@CurrentUser() user: AuthenticatedUser): Promise<DriverOffer[]> {
    return this.offers.listMinePending(user);
  }

  @ApiOperation({
    summary: 'Accept a dispatch offer (confirms the assignment)',
  })
  @Roles(ROLES.DRIVER)
  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderAssignment> {
    return this.offers.accept(user, id);
  }

  @ApiOperation({
    summary: 'Reject a dispatch offer (moves to the next driver)',
  })
  @Roles(ROLES.DRIVER)
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectOfferDto,
  ): Promise<DriverOffer> {
    return this.offers.reject(user, id, dto.reason);
  }
}
