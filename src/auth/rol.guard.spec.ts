import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RolGuard, VEREISTE_ROL, VereistRol } from './rol.guard';

function context(
  vereist: string[] | undefined,
  sessieRol: string | undefined,
): ExecutionContext {
  const request = {
    sessie: sessieRol ? { role: sessieRol } : undefined,
  };
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('RolGuard met meerdere toegestane rollen', () => {
  it('laat een sessie door wiens rol in de lijst staat', () => {
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['admin', 'user']);
    const guard = new RolGuard(reflector);
    const ctx = context(['admin', 'user'], 'user');

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('weigert een sessie wiens rol niet in de lijst staat', () => {
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['admin', 'user']);
    const guard = new RolGuard(reflector);
    const ctx = context(['admin', 'user'], 'reviewer');

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('blijft werken met precies één toegestane rol (bestaand gedrag)', () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const guard = new RolGuard(reflector);
    const ctx = context(['admin'], 'admin');

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('weigert zonder sessie, ook met een rol-eis', () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const guard = new RolGuard(reflector);
    const ctx = context(['admin'], undefined);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('laat door zonder rol-eis, ook zonder sessie-rolmatch nodig', () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const guard = new RolGuard(reflector);
    const ctx = context(undefined, 'reviewer');

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('VereistRol zet de metadata-key correct', () => {
    const decorator = VereistRol('admin', 'user');
    expect(VEREISTE_ROL).toBe('vereisteRol');
    expect(typeof decorator).toBe('function');
  });
});
