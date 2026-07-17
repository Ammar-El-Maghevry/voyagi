import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import {
  LivenessResponseDto,
  ReadinessResponseDto,
} from './dto/health-response.dto';
import {
  HealthService,
  LivenessStatus,
  ReadinessStatus,
} from './health.service';

/**
 * Health probes. Public (no authentication) and excluded from rate limiting so
 * orchestrators can poll them freely. Responses use the standard success
 * envelope; readiness returns 503 (via the exception filter) when a dependency
 * is unavailable.
 */
@ApiTags('health')
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe: confirms the process is running.' })
  @ApiOkResponse({ type: LivenessResponseDto })
  live(): LivenessStatus {
    return this.healthService.checkLiveness();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe: confirms required dependencies are available.',
  })
  @ApiOkResponse({ type: ReadinessResponseDto })
  ready(): Promise<ReadinessStatus> {
    return this.healthService.checkReadiness();
  }
}
