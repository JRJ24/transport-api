import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/common/decorators/public.decorator';
import { PrismaService } from '@/database/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness: the process answers. It does NOT touch the database on purpose:
   * the Docker healthcheck calls it every 30 s, and a `SELECT 1` there kept
   * Neon from ever scaling to zero.
   */
  @ApiOperation({ summary: 'Liveness probe (no database access)' })
  @Public()
  @Get()
  check(): { status: 'ok'; uptimeSec: number; timestamp: string } {
    return {
      status: 'ok',
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness: also checks the database. For manual checks and occasional
   * monitoring; polling it often keeps the Neon compute awake.
   */
  @ApiOperation({ summary: 'Readiness probe (checks the database)' })
  @Public()
  @Get('ready')
  async ready(): Promise<{
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
