import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Juan Pérez' })
  @IsOptional()
  @IsString()
  @Length(3, 120)
  fullName?: string;

  @ApiPropertyOptional({ example: '+18095551234' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/, {
    message: 'phone must be a valid phone number (10-15 digits)',
  })
  phone?: string;
}
