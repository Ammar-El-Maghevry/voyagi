import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { IsEmail, IsInt, Max, Min } from 'class-validator';
import { validationPipeOptions } from './validation-pipe.options';
import { ValidationException } from './validation.exception';

class SampleDto {
  @IsEmail()
  email!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number;
}

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: SampleDto,
  data: '',
};

describe('global validation policy', () => {
  const pipe = new ValidationPipe(validationPipeOptions);

  it('accepts and transforms a valid payload', async () => {
    const result = await pipe.transform(
      { email: 'a@b.com', quantity: '5' },
      metadata,
    );

    expect(result).toBeInstanceOf(SampleDto);
    expect(result.quantity).toBe(5);
  });

  it('throws a ValidationException with per-field details on invalid input', async () => {
    expect.assertions(3);
    try {
      await pipe.transform({ email: 'not-an-email', quantity: 999 }, metadata);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationException);
      const fields = (error as ValidationException).fields;
      expect(Object.keys(fields)).toEqual(
        expect.arrayContaining(['email', 'quantity']),
      );
      expect(fields.email.length).toBeGreaterThan(0);
    }
  });

  it('rejects unknown (non-whitelisted) properties', async () => {
    expect.assertions(2);
    try {
      await pipe.transform(
        { email: 'a@b.com', quantity: 5, isAdmin: true },
        metadata,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationException);
      expect((error as ValidationException).fields).toHaveProperty('isAdmin');
    }
  });
});
