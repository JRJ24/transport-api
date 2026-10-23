import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './auth/presentation/dto/login.dto';
import { RegisterDto } from './auth/presentation/dto/register.dto';
import { ChangePasswordDto } from './users/dto/account.dto';
import { CreateUserDto } from './users/dto/create-user.dto';
import { CreateTmsCustomerDto } from './customers/dto/create-tms-customer.dto';
import { RegisterDriverDto } from '../operations/drivers/dto/register-driver.dto';

// bcrypt solo usa los primeros 72 bytes: todo DTO que fija una contraseña
// debe rechazar lo que el login no aceptaría o lo que bcrypt truncaría.
const SETTERS: Array<[string, new () => object, string]> = [
  ['RegisterDto', RegisterDto, 'password'],
  ['RegisterDriverDto', RegisterDriverDto, 'password'],
  ['ChangePasswordDto', ChangePasswordDto, 'newPassword'],
  ['CreateUserDto', CreateUserDto, 'password'],
  ['CreateTmsCustomerDto', CreateTmsCustomerDto, 'password'],
];

const ascii = (bytes: number) => 'a1' + 'a'.repeat(bytes - 2);
// 38 caracteres pero 74 bytes en UTF-8: pasa un MaxLength(72) por caracteres.
const MULTIBYTE_74 = 'a1' + 'ñ'.repeat(36);

async function errorsOn(
  dto: new () => object,
  field: string,
  value: string,
): Promise<string[]> {
  const errors = await validate(plainToInstance(dto, { [field]: value }));
  const error = errors.find((e) => e.property === field);
  return Object.keys(error?.constraints ?? {});
}

describe('password byte limit (LOG-API-014)', () => {
  it.each(SETTERS)('%s accepts a 72-byte password', async (_, dto, field) => {
    expect(await errorsOn(dto, field, ascii(72))).toEqual([]);
  });

  it.each(SETTERS)('%s rejects a 73-byte password', async (_, dto, field) => {
    expect(await errorsOn(dto, field, ascii(73))).not.toEqual([]);
  });

  it.each(SETTERS)(
    '%s rejects a multibyte password over 72 bytes',
    async (_, dto, field) => {
      expect(Buffer.byteLength(MULTIBYTE_74)).toBe(74);
      expect(await errorsOn(dto, field, MULTIBYTE_74)).not.toEqual([]);
    },
  );

  it('login accepts the longest password a user can set', async () => {
    expect(await errorsOn(LoginDto, 'password', ascii(72))).toEqual([]);
  });

  it('change password still accepts a long current password', async () => {
    // Usuarios que fijaron una de hasta 128 antes del fix deben poder cambiarla.
    expect(
      await errorsOn(ChangePasswordDto, 'currentPassword', ascii(128)),
    ).toEqual([]);
  });
});
