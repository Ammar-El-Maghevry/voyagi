import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AvailabilityController } from './availability.controller';

describe('AvailabilityController', () => {
  it('marks every route on the controller as public', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AvailabilityController)).toBe(
      true,
    );
  });
});
