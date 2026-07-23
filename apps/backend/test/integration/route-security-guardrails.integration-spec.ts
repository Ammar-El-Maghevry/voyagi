import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
} from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';
import { REQUIRED_PERMISSIONS_KEY } from '../../src/modules/authorization/decorators/require-permissions.decorator';
import { ALL_PERMISSIONS } from '../../src/modules/authorization/permission.enum';

interface Route {
  controller: string;
  handler: string;
  method: string;
  path: string;
  isPublic: boolean;
  permissions: string[];
}

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
};

function norm(path: unknown): string {
  const value = typeof path === 'string' ? path : '';
  return value.replace(/^\/+|\/+$/g, '');
}

/**
 * Only these route paths may opt out of the global authentication guard. Any new
 * @Public() route not listed here fails the build — a deliberate tripwire so
 * authentication can never be dropped by accident.
 */
const PUBLIC_ALLOWLIST = new Set<string>([
  'health/live',
  'health/ready',
  'trips/search',
  'trips/:tripId/availability',
  'trips/:tripId/price-preview',
  'webhooks/payments/:provider',
]);

/**
 * Routes intentionally governed by resource ownership / self-scope rather than a
 * @RequirePermissions decorator (the service enforces ownership in SQL).
 */
const OWNERSHIP_WRITE_ALLOWLIST = new Set<string>([
  'POST bookings', // passenger-owned booking creation
  'POST bookings/:bookingId/cancel', // passenger-owned cancel
  'POST payments', // passenger-owned online payment
  'POST bookings/:bookingId/tickets', // passenger self-issue for owned booking
  'POST webhooks/payments/:provider', // public, signature-verified
  'PATCH profiles/me', // self profile update (if present)
]);

describe('Route security guardrails (integration)', () => {
  let routes: Route[];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();
    const discovery = moduleRef.get(DiscoveryService);
    const scanner = moduleRef.get(MetadataScanner);

    routes = [];
    for (const wrapper of discovery.getControllers()) {
      const { metatype } = wrapper;
      if (!metatype) continue;
      const controllerPath = norm(Reflect.getMetadata(PATH_METADATA, metatype));
      const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, metatype) === true;
      const classPerms =
        (Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, metatype) as
          string[] | undefined) ?? [];
      const proto = metatype.prototype;
      for (const handler of scanner.getAllMethodNames(proto)) {
        const fn = proto[handler];
        const methodPath = Reflect.getMetadata(PATH_METADATA, fn);
        if (methodPath === undefined) continue; // not a route handler
        const httpMethod = Reflect.getMetadata(METHOD_METADATA, fn) as number;
        const isPublic =
          classPublic || Reflect.getMetadata(IS_PUBLIC_KEY, fn) === true;
        const handlerPerms =
          (Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, fn) as
            string[] | undefined) ?? [];
        const full = [controllerPath, norm(methodPath)]
          .filter(Boolean)
          .join('/');
        routes.push({
          controller: metatype.name,
          handler,
          method: METHOD_NAMES[httpMethod] ?? String(httpMethod),
          path: full,
          isPublic,
          permissions: [...classPerms, ...handlerPerms],
        });
      }
    }
    await moduleRef.close();
  });

  it('discovers a non-trivial route table', () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it('exposes only allowlisted public routes (secure by default)', () => {
    const publicPaths = routes.filter((r) => r.isPublic).map((r) => r.path);
    const unexpected = publicPaths.filter((p) => !PUBLIC_ALLOWLIST.has(p));
    expect(unexpected).toEqual([]);
  });

  it('uses only permissions that exist in the central catalog', () => {
    const catalog = new Set<string>(ALL_PERMISSIONS);
    const unknown = routes
      .flatMap((r) => r.permissions)
      .filter((permission) => !catalog.has(permission));
    expect([...new Set(unknown)]).toEqual([]);
  });

  it('every write route is either permission-gated or a documented ownership route', () => {
    const writes = routes.filter((r) =>
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method),
    );
    const ungoverned = writes.filter(
      (r) =>
        r.permissions.length === 0 &&
        !OWNERSHIP_WRITE_ALLOWLIST.has(`${r.method} ${r.path}`),
    );
    expect(
      ungoverned.map(
        (r) => `${r.method} ${r.path} (${r.controller}.${r.handler})`,
      ),
    ).toEqual([]);
  });
});
