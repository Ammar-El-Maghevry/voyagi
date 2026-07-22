import { Module } from '@nestjs/common';
import { PostgresSeatLayoutsRepository } from './postgres-seat-layouts.repository';
import { SeatLayoutsController } from './seat-layouts.controller';
import { SEAT_LAYOUTS_REPOSITORY } from './seat-layouts.repository';
import { SeatLayoutsService } from './seat-layouts.service';

/**
 * Seat-layouts module (Phase 7).
 *
 * Owns read-only access to the global seat-layout template catalog. Layouts are
 * not tenant-owned, so it needs no entitlement resolution — authentication
 * alone governs reads. The database connection comes from the global
 * `DatabaseModule`.
 */
@Module({
  controllers: [SeatLayoutsController],
  providers: [
    { provide: SEAT_LAYOUTS_REPOSITORY, useClass: PostgresSeatLayoutsRepository },
    SeatLayoutsService,
  ],
})
export class SeatLayoutsModule {}
