import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { DatabaseConnectionError } from '../src/infrastructure/database/database.errors';
import { AUTH_KEY_RESOLVER } from '../src/modules/auth/jwks-key-resolver.provider';
import { CITIES_REPOSITORY } from '../src/modules/cities/cities.repository';
import { SEAT_LAYOUTS_REPOSITORY } from '../src/modules/seat-layouts/seat-layouts.repository';
import { STATIONS_REPOSITORY } from '../src/modules/stations/stations.repository';
import { InMemoryCitiesRepository } from './support/in-memory-cities.repository';
import { InMemorySeatLayoutsRepository } from './support/in-memory-seat-layouts.repository';
import { InMemoryStationsRepository } from './support/in-memory-stations.repository';
import {
  generateTestKey,
  localJwksResolver,
  signTestToken,
  type TestSigningKey,
} from './support/auth-test-keys';

/**
 * End-to-end coverage of the read-only catalog: cities, stations and seat
 * layouts. These are global reference/template data readable by any
 * authenticated user (no permission, no company scope); there are no write
 * endpoints. Runs the full HTTP pipeline against in-memory repositories.
 */
describe('Catalog: cities, stations, seat-layouts (e2e)', () => {
  const ISSUER = 'http://127.0.0.1:54321/auth/v1';
  const AUDIENCE = 'authenticated';
  const USER = '33333333-3333-4333-8333-333333333333';

  let app: INestApplication;
  let key: TestSigningKey;
  let citiesRepo: InMemoryCitiesRepository;
  let stationsRepo: InMemoryStationsRepository;
  let seatLayoutsRepo: InMemorySeatLayoutsRepository;

  const auth = () =>
    signTestToken(key, { issuer: ISSUER, audience: AUDIENCE, subject: USER }).then(
      (t) => `Bearer ${t}`,
    );

  beforeAll(async () => {
    key = await generateTestKey('catalog-e2e', 'ES256');
    citiesRepo = new InMemoryCitiesRepository();
    stationsRepo = new InMemoryStationsRepository();
    seatLayoutsRepo = new InMemorySeatLayoutsRepository();

    citiesRepo.addCity({ id: '1', nameAr: 'نواكشوط', nameFr: 'Nouakchott' });
    citiesRepo.addCity({ id: '2', nameAr: 'نواذيبو', nameFr: 'Nouadhibou' });
    citiesRepo.addCity({ id: '3', nameAr: 'قديمة', nameFr: 'Ancienne', isActive: false });

    stationsRepo.addStation({ id: '10', cityId: '1', nameAr: 'محطة أ', nameFr: 'Gare A' });
    stationsRepo.addStation({ id: '11', cityId: '2', nameAr: 'محطة ب', nameFr: 'Gare B' });

    seatLayoutsRepo.addSeatLayout({ id: '5', name: '2+2 / 40', totalSeats: 40, seatNumbers: ['1', '2', '3'] });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_KEY_RESOLVER)
      .useValue(localJwksResolver(key))
      .overrideProvider(CITIES_REPOSITORY)
      .useValue(citiesRepo)
      .overrideProvider(STATIONS_REPOSITORY)
      .useValue(stationsRepo)
      .overrideProvider(SEAT_LAYOUTS_REPOSITORY)
      .useValue(seatLayoutsRepo)
      .compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated reference reads (401)', async () => {
    for (const path of ['/api/v1/cities', '/api/v1/stations', '/api/v1/seat-layouts']) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status).toBe(401);
    }
  });

  it('lists only active cities to any authenticated user, in id order', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/cities')
      .set('Authorization', await auth());
    expect(res.status).toBe(200);
    // The inactive city (3) is hidden.
    expect(res.body.data.map((c: { id: string }) => c.id)).toEqual(['1', '2']);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
  });

  it('reads a single city and 404s an unknown/inactive one', async () => {
    const ok = await request(app.getHttpServer())
      .get('/api/v1/cities/1')
      .set('Authorization', await auth());
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ id: '1', nameFr: 'Nouakchott' });

    const inactive = await request(app.getHttpServer())
      .get('/api/v1/cities/3')
      .set('Authorization', await auth());
    expect(inactive.status).toBe(404);
  });

  it('filters stations by city', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/stations?cityId=1')
      .set('Authorization', await auth());
    expect(res.status).toBe(200);
    expect(res.body.data.map((s: { id: string }) => s.id)).toEqual(['10']);
  });

  it('reads a seat layout with its seat labels', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/seat-layouts/5')
      .set('Authorization', await auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: '5', totalSeats: 40, seatNumbers: ['1', '2', '3'] });
  });

  it('exposes no write endpoints on the reference catalog (404)', async () => {
    for (const path of ['/api/v1/cities', '/api/v1/stations', '/api/v1/seat-layouts']) {
      const res = await request(app.getHttpServer())
        .post(path)
        .set('Authorization', await auth())
        .send({ nameAr: 'x', nameFr: 'y' });
      expect(res.status).toBe(404);
    }
  });

  it('surfaces a repository outage as 503', async () => {
    citiesRepo.failNextWith(new DatabaseConnectionError());
    const res = await request(app.getHttpServer())
      .get('/api/v1/cities')
      .set('Authorization', await auth());
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_FAILURE');
  });
});
