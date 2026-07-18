import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response-envelope.interceptor';
import { requestIdMiddleware } from '../src/common/request-context/request-id.middleware';
import type { AuthenticatedPrincipal } from '../src/modules/auth/authenticated-principal';
import type { AuthorizationContext } from '../src/modules/authorization/authorization-context';
import {
  AUTHORIZATION_CONTEXT_RESOLVER,
  type AuthorizationContextResolver,
  type AuthorizationResolutionRequest,
} from '../src/modules/authorization/authorization-context-resolver';
import { AuthorizationModule } from '../src/modules/authorization/authorization.module';
import { AuthorizationGuard } from '../src/modules/authorization/authorization.guard';
import { COMPANY_ID_HEADER } from '../src/modules/authorization/company-id.util';
import { AuthorizationCtx } from '../src/modules/authorization/decorators/authorization-context.decorator';
import { RequirePermissions } from '../src/modules/authorization/decorators/require-permissions.decorator';
import { Permission } from '../src/modules/authorization/permission.enum';

/**
 * End-to-end coverage of the global authorization guard through the full HTTP
 * stack, using a probe controller and a fake context resolver (the real,
 * database-backed resolver is a later phase). A stub middleware attaches a
 * verified principal, standing in for the authentication guard so the
 * authorization pipeline can be exercised in isolation.
 */
@Controller('probe')
class ProbeController {
  @Get('open')
  open(): { ok: true } {
    return { ok: true };
  }

  @Get('read')
  @RequirePermissions(Permission.CompaniesRead)
  read(@AuthorizationCtx() context: AuthorizationContext): {
    companyId?: string;
    permissions: readonly string[];
  } {
    return { companyId: context.companyId, permissions: context.permissions };
  }

  @Get('manage')
  @RequirePermissions(Permission.CompaniesUpdate)
  manage(): { ok: true } {
    return { ok: true };
  }
}

const principal = { userId: 'user-1' } as AuthenticatedPrincipal;

/** Fake resolver whose behavior each test controls. */
let resolveImpl: (
  input: AuthorizationResolutionRequest,
) => Promise<AuthorizationContext | null>;

const fakeResolver: AuthorizationContextResolver = {
  resolve: (input) => resolveImpl(input),
};

function contextGranting(permissions: string[], companyId?: string): AuthorizationContext {
  return {
    userId: 'user-1',
    profileId: 'profile-1',
    companyId,
    membershipId: 'membership-1',
    role: 'manager',
    permissions,
  };
}

async function buildApp(options: {
  useFakeResolver: boolean;
}): Promise<INestApplication> {
  // When useFakeResolver is false the module's default resolver is exercised;
  // a locally-provided binding takes precedence over the exported default.
  const providers = [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
    ...(options.useFakeResolver
      ? [{ provide: AUTHORIZATION_CONTEXT_RESOLVER, useValue: fakeResolver }]
      : []),
  ];

  const moduleRef = await Test.createTestingModule({
    imports: [AuthorizationModule],
    controllers: [ProbeController],
    providers,
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.use(requestIdMiddleware);
  // Stand in for the authentication guard: attach a verified principal.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.principal = principal;
    next();
  });
  await app.init();
  return app;
}

describe('Authorization (e2e)', () => {
  describe('with a test context resolver', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await buildApp({ useFakeResolver: true });
    });
    afterAll(async () => {
      await app.close();
    });

    it('allows a route with no permission requirement (200)', async () => {
      const response = await request(app.getHttpServer()).get('/probe/open');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ success: true, data: { ok: true } });
    });

    it('allows and exposes the resolved context when the permission is granted', async () => {
      resolveImpl = async () =>
        contextGranting([Permission.CompaniesRead], 'company-42');

      const response = await request(app.getHttpServer())
        .get('/probe/read')
        .set(COMPANY_ID_HEADER, 'company-42');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        data: {
          companyId: 'company-42',
          permissions: [Permission.CompaniesRead],
        },
      });
    });

    it('forwards the request company id to the resolver', async () => {
      const seen: AuthorizationResolutionRequest[] = [];
      resolveImpl = async (input) => {
        seen.push(input);
        return contextGranting([Permission.CompaniesRead], input.companyId);
      };

      await request(app.getHttpServer())
        .get('/probe/read')
        .set(COMPANY_ID_HEADER, 'company-7')
        .expect(200);

      expect(seen[0].companyId).toBe('company-7');
      expect(seen[0].principal.userId).toBe('user-1');
    });

    it('denies with 403 FORBIDDEN when the permission is missing', async () => {
      resolveImpl = async () => contextGranting([]);

      const response = await request(app.getHttpServer()).get('/probe/read');

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        success: false,
        error: { code: 'FORBIDDEN' },
        path: '/probe/read',
      });
      expect(typeof response.body.requestId).toBe('string');
    });

    it('does not leak the missing permission or a stack trace in the response', async () => {
      resolveImpl = async () => contextGranting([]);

      const response = await request(app.getHttpServer()).get('/probe/manage');

      const body = JSON.stringify(response.body);
      expect(response.status).toBe(403);
      expect(body).not.toContain('companies.update');
      expect(body).not.toMatch(/at .*\(.*\.ts/);
      expect(response.body.error).not.toHaveProperty('stack');
    });

    it('denies with 403 when no active context can be resolved', async () => {
      resolveImpl = async () => null;

      const response = await request(app.getHttpServer()).get('/probe/read');

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('with the module default resolver', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await buildApp({ useFakeResolver: false });
    });
    afterAll(async () => {
      await app.close();
    });

    it('leaves open routes working (no authorization required)', async () => {
      await request(app.getHttpServer()).get('/probe/open').expect(200);
    });

    it('denies permission-protected routes with 403 (no permission granted)', async () => {
      const response = await request(app.getHttpServer()).get('/probe/read');

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        success: false,
        error: { code: 'FORBIDDEN' },
      });
    });
  });
});
