import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Body de PATCH /incidents/:id/escalate. Antes era un tipo de TypeScript
 * ({ reason?: string }) y el ValidationPipe no valida un body sin clase: un
 * `reason` que no fuera texto llegaba a `reason.trim()` y salia un 500.
 *
 * Sin MaxLength a proposito: el portal manda el mismo texto que usa para
 * comentar y un tope nuevo cambiaria lo que el staff ya puede enviar; aqui
 * solo se rechaza lo que antes rompia.
 */
export class EscalateIncidentDto {
  @ApiPropertyOptional({ example: 'El cliente no responde' })
  @IsOptional()
  @IsString()
  reason?: string;
}
