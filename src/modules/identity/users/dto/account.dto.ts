import { ApiProperty } from '@nestjs/swagger';
import {
  IsByteLength,
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PASSWORD_MAX_BYTES } from '@/common/constants/password.constant';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ minLength: 8, maxLength: PASSWORD_MAX_BYTES })
  @IsString()
  @MinLength(8)
  @IsByteLength(0, PASSWORD_MAX_BYTES, {
    message: `$property must not exceed ${PASSWORD_MAX_BYTES} bytes`,
  })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'newPassword must contain letters and numbers',
  })
  newPassword!: string;
}

export class RequestEmailChangeDto {
  @ApiProperty({ example: 'nuevo@empresa.com.do' })
  @IsEmail()
  @MaxLength(160)
  newEmail!: string;

  @ApiProperty({ description: 'Current password, to confirm it is the owner' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class ConfirmEmailChangeDto {
  @ApiProperty({ example: '482913' })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;
}
