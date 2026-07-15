import { ApiProperty } from '@nestjs/swagger';
import { IsJWT } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token issued at login or last refresh' })
  @IsJWT()
  refreshToken!: string;
}
