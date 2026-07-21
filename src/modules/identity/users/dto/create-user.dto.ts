import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ROLES } from '@generated/prisma/enums';

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
  password!: string;

  @ApiProperty({ enum: ROLES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(ROLES, { each: true })
  roles!: ROLES[];
}
