import { CustomDecorator, SetMetadata } from '@nestjs/common';
import type { Permission } from '../permission.enum';

/** Metadata key holding the permissions required to access a route. */
export const REQUIRED_PERMISSIONS_KEY = 'voyagi:requiredPermissions';

/**
 * Require the caller to hold every listed {@link Permission} (all-of).
 *
 * Applied to a controller or handler. Requirements declared on the controller
 * and the handler combine, so a controller-level baseline is additive with
 * per-route requirements. Routes with no requirement are open to any
 * authenticated caller; authentication itself is enforced separately by the
 * authentication guard.
 */
export const RequirePermissions = (
  ...permissions: Permission[]
): CustomDecorator => SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
