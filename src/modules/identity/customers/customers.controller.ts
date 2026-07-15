import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { CustomersService } from './customers.service';
import { CreateCustomerAddressDto } from './dto/create-customer-address.dto';
import { CreateCustomerProfileDto } from './dto/create-customer-profile.dto';
import { UpdateCustomerAddressDto } from './dto/update-customer-address.dto';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';
import {
  toCustomerAddressResponse,
  toCustomerProfileResponse,
  type CustomerAddressResponse,
  type CustomerProfileResponse,
} from './presenters/customer.presenter';

@ApiTags('customers')
@ApiBearerAuth()
@Roles(ROLES.CUSTOMER)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @ApiOperation({ summary: 'Get my customer profile' })
  @Get('me')
  async getMyProfile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CustomerProfileResponse> {
    return toCustomerProfileResponse(
      await this.customersService.getMyProfile(user.id),
    );
  }

  @ApiOperation({ summary: 'Create my customer profile after registration' })
  @Post('me')
  async createMyProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCustomerProfileDto,
  ): Promise<CustomerProfileResponse> {
    return toCustomerProfileResponse(
      await this.customersService.createProfile(user.id, dto),
    );
  }

  @ApiOperation({ summary: 'Update my customer profile' })
  @Patch('me')
  async updateMyProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCustomerProfileDto,
  ): Promise<CustomerProfileResponse> {
    return toCustomerProfileResponse(
      await this.customersService.updateProfile(user.id, dto),
    );
  }

  @ApiOperation({ summary: 'List my customer addresses' })
  @Get('me/addresses')
  async listMyAddresses(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CustomerAddressResponse[]> {
    const addresses = await this.customersService.listAddresses(user.id);

    return addresses.map(toCustomerAddressResponse);
  }

  @ApiOperation({ summary: 'Create a customer address' })
  @Post('me/addresses')
  async createMyAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCustomerAddressDto,
  ): Promise<CustomerAddressResponse> {
    return toCustomerAddressResponse(
      await this.customersService.createAddress(user.id, dto),
    );
  }

  @ApiOperation({ summary: 'Update a customer address' })
  @Patch('me/addresses/:id')
  async updateMyAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerAddressDto,
  ): Promise<CustomerAddressResponse> {
    return toCustomerAddressResponse(
      await this.customersService.updateAddress(user.id, id, dto),
    );
  }

  @ApiOperation({ summary: 'Delete a customer address' })
  @Delete('me/addresses/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMyAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.customersService.deleteAddress(user.id, id);
  }
}
