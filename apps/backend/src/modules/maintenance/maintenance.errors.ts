import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-code.enum';

class MaintenanceHttpError extends HttpException {
  constructor(message: string, status: HttpStatus) {
    super(
      {
        code: status === HttpStatus.UNPROCESSABLE_ENTITY
          ? ErrorCode.BUSINESS_RULE_VIOLATION
          : status === HttpStatus.NOT_FOUND
            ? ErrorCode.RESOURCE_NOT_FOUND
            : status === HttpStatus.BAD_REQUEST
              ? ErrorCode.VALIDATION_ERROR
              : ErrorCode.CONFLICT,
        message,
      },
      status,
    );
  }
}

export class MaintenanceCompanyInvalidError extends MaintenanceHttpError {
  constructor() {
    super('A valid X-Company-Id header is required.', HttpStatus.BAD_REQUEST);
  }
}

export class MaintenanceNotFoundError extends MaintenanceHttpError {
  constructor() {
    super('The requested maintenance record was not found.', HttpStatus.NOT_FOUND);
  }
}

export class MaintenanceConflictError extends MaintenanceHttpError {
  constructor(message = 'The maintenance operation conflicts with the bus schedule.') {
    super(message, HttpStatus.CONFLICT);
  }
}

export class MaintenanceBusInvalidError extends MaintenanceHttpError {
  constructor(message = 'The bus was not found or is not available for maintenance.') {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
