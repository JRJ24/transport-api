import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsByteLength,
  IsEmail,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ROLES } from '@generated/prisma/enums';
import { PASSWORD_MAX_BYTES } from '@/common/constants/password.constant';

export class CreateUserDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  fullName!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(30)
  phone!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @IsByteLength(0, PASSWORD_MAX_BYTES, {
    message: `$property must not exceed ${PASSWORD_MAX_BYTES} bytes`,
  })
  password!: string;

  @ApiProperty({ enum: ROLES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(ROLES, { each: true })
  roles!: ROLES[];
}
