import { CustomDecorator, SetMetadata } from '@nestjs/common';

/** Metadata key marking a route (or controller) as publicly accessible. */
export const IS_PUBLIC_KEY = 'voyagi:isPublic';

/**
 * Mark a route or controller as public, opting it out of the global
 * authentication guard. Access is protected by default; only routes explicitly
 * decorated with `@Public()` skip authentication.
 */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
