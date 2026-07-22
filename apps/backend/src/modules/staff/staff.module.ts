import { Module } from '@nestjs/common';
import { PostgresStaffRepository } from './postgres-staff.repository';
import { StaffController } from './staff.controller';
import { STAFF_REPOSITORY } from './staff.repository';
import { StaffService } from './staff.service';

/**
 * Staff module (Phase 6).
 *
 * Owns company staff-member listing/read/create/update and activation
 * transitions. Staff are company-scoped (no branch dimension), so it needs no
 * entitlement resolution — the guard's company permission plus `company_id`
 * SQL scoping are the full boundary. The database connection comes from the
 * global `DatabaseModule`.
 */
@Module({
  controllers: [StaffController],
  providers: [
    { provide: STAFF_REPOSITORY, useClass: PostgresStaffRepository },
    StaffService,
  ],
})
export class StaffModule {}
