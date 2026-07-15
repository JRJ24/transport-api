import { Module } from '@nestjs/common';
import { DashboardModule } from './dashboard/dashboard.module';
import { CatalogsModule } from './catalogs/catalogs.module';
import { ParametersModule } from './parameters/parameters.module';
import { ReportsModule } from './reports/reports.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    DashboardModule,
    CatalogsModule,
    ParametersModule,
    ReportsModule,
    AuditModule,
  ],
})
export class AdministrationModule {}
