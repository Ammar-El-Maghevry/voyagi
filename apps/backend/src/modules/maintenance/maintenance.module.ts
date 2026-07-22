import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MaintenanceController } from './maintenance.controller';
import { MAINTENANCE_REPOSITORY } from './maintenance.repository';
import { MAINTENANCE_SCHEDULING_PORT } from './maintenance-scheduling.port';
import { PostgresMaintenanceRepository } from './postgres-maintenance.repository';
import { MaintenanceService } from './maintenance.service';

@Module({
  imports: [AuditModule],
  controllers: [MaintenanceController],
  providers: [
    { provide: MAINTENANCE_REPOSITORY, useClass: PostgresMaintenanceRepository },
    MaintenanceService,
    { provide: MAINTENANCE_SCHEDULING_PORT, useExisting: MaintenanceService },
  ],
  exports: [MAINTENANCE_SCHEDULING_PORT],
})
export class MaintenanceModule {}
