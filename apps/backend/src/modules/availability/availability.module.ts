import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { AVAILABILITY_REPOSITORY } from './availability.repository';
import { AvailabilityService } from './availability.service';
import { PostgresAvailabilityRepository } from './postgres-availability.repository';

/** Public, read-only trip discovery and authoritative seat availability. */
@Module({
  controllers: [AvailabilityController],
  providers: [
    {
      provide: AVAILABILITY_REPOSITORY,
      useClass: PostgresAvailabilityRepository,
    },
    AvailabilityService,
  ],
  exports: [AVAILABILITY_REPOSITORY, AvailabilityService],
})
export class AvailabilityModule {}
