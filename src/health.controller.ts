import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/common/decorators/public.decorator';
import { PrismaService } from '@/database/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({ summary: 'Liveness/readiness probe' })
  @Public()
  @Get()
  async check(): Promise<{
    status: 'ok' | 'degraded';
    database: 'up' | 'down';
    uptimeSec: number;
    timestamp: string;
  }> {
    let database: 'up' | 'down' = 'up';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
