import { Module } from '@nestjs/common';
import { CommissionsController } from './commissions.controller';
import { COMMISSIONS_REPOSITORY } from './commissions.repository';
import { CommissionsService } from './commissions.service';
import { PostgresCommissionsRepository } from './postgres-commissions.repository';

@Module({
  controllers: [CommissionsController],
  providers: [
    { provide: COMMISSIONS_REPOSITORY, useClass: PostgresCommissionsRepository },
    CommissionsService,
  ],
  exports: [CommissionsService],
})
export class CommissionsModule {}
