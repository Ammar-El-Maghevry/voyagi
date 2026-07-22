import { type RoutePriceRow, toRoutePrice } from './route-price.mapper';

const baseRow: RoutePriceRow = {
  id: '3',
  route_id: '9',
  price_mru: '500.00',
  currency: 'MRU',
  effective_from: new Date('2026-01-01T00:00:00.000Z'),
  effective_to: null,
  change_reason: 'Initial price',
  changed_by_user_id: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
};

describe('toRoutePrice', () => {
  it('maps an open period (effective_to null → undefined)', () => {
    const price = toRoutePrice(baseRow);
    expect(price).toMatchObject({
      id: '3',
      routeId: '9',
      priceMru: 500,
      currency: 'MRU',
      changeReason: 'Initial price',
    });
    expect(price.effectiveTo).toBeUndefined();
    expect(price.changedByUserId).toBeUndefined();
  });

  it('maps a closed period with its end timestamp', () => {
    const end = new Date('2026-02-01T00:00:00.000Z');
    const price = toRoutePrice({ ...baseRow, effective_to: end, changed_by_user_id: 'u1' });
    expect(price.effectiveTo).toBe(end);
    expect(price.changedByUserId).toBe('u1');
  });
});
