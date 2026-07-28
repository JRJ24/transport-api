import { PartialType } from '@nestjs/swagger';
import { CreateTmsCustomerDto } from './create-tms-customer.dto';

export class UpdateTmsCustomerDto extends PartialType(CreateTmsCustomerDto) {}
