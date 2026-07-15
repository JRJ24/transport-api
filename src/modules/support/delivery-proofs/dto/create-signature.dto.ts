import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateSignatureDto {
  @ApiProperty({ example: 'https://storage.local/signature.png' })
  @IsString()
  @IsUrl({ require_tld: false })
  signatureUrl!: string;

  @ApiProperty({ example: 'Maria Perez' })
  @IsString()
  @MaxLength(120)
  signerName!: string;
}
