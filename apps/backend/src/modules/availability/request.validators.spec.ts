import { validate } from 'class-validator';
import { SearchPublicTripsQueryDto } from './dto/search-public-trips-query.dto';
import { TripIdParamDto } from './dto/trip-id-param.dto';
import { isPositiveBigInt, isYyyyMmDd } from './request.validators';

describe('availability request validators', () => {
  it('accepts only positive PostgreSQL bigint ids', () => {
    expect(isPositiveBigInt('1')).toBe(true);
    expect(isPositiveBigInt('9223372036854775807')).toBe(true);
    expect(isPositiveBigInt('0')).toBe(false);
    expect(isPositiveBigInt('01')).toBe(false);
    expect(isPositiveBigInt('-1')).toBe(false);
    expect(isPositiveBigInt('9223372036854775808')).toBe(false);
  });

  it('accepts only real calendar dates in YYYY-MM-DD form', () => {
    expect(isYyyyMmDd('2028-02-29')).toBe(true);
    expect(isYyyyMmDd('2026-02-29')).toBe(false);
    expect(isYyyyMmDd('2026-7-22')).toBe(false);
    expect(isYyyyMmDd('2026-07-22T00:00:00Z')).toBe(false);
  });

  it('applies the validators to query and path DTOs', async () => {
    const query = Object.assign(new SearchPublicTripsQueryDto(), {
      originStationId: '0',
      destinationStationId: '2',
      date: '2026-02-30',
    });
    const params = Object.assign(new TripIdParamDto(), { tripId: 'bad' });

    expect(
      (await validate(query)).map((error) => error.property).sort(),
    ).toEqual(['date', 'originStationId']);
    expect((await validate(params)).map((error) => error.property)).toEqual([
      'tripId',
    ]);
  });
});
