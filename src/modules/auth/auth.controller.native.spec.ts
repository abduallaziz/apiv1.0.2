import { AuthController } from './auth.controller';

// G1 (owner approved 2026-11-09): native Android clients get the refresh
// token in the body (X-Sefay-Client: android); browsers keep the httpOnly
// cookie and never receive a token in the body.

const LOGIN_RESULT = {
  access_token: 'access',
  realtime_token: 'rt',
  refresh_token: 'refresh-secret',
  user: { id: 'u1' },
};

function build() {
  const authService = {
    login: jest.fn().mockResolvedValue(LOGIN_RESULT),
    refresh: jest.fn().mockResolvedValue({
      access_token: 'access2',
      realtime_token: 'rt2',
      refresh_token: 'refresh-secret-2',
    }),
  };
  const controller = new AuthController(authService as never);
  const res = {
    cookie: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return { controller, authService, res };
}

const req = (headers: Record<string, string> = {}, cookies: Record<string, string> = {}) =>
  ({ headers, cookies, ip: '1.1.1.1', socket: {} }) as never;

const LOGIN_DTO = { email: 'a@b.com', password: 'secret1', device_name: 'Sunmi' } as never;

describe('AuthController native client mode (G1)', () => {
  it('web login: sets the cookie and puts NO refresh token in the body', async () => {
    const { controller, res } = build();
    const r = await controller.login(LOGIN_DTO, req(), res as never);
    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(r).not.toHaveProperty('refresh_token');
    expect(r.access_token).toBe('access');
  });

  it('android login: refresh token in the body, no cookie', async () => {
    const { controller, res } = build();
    const r = await controller.login(LOGIN_DTO, req({ 'x-sefay-client': 'android' }), res as never);
    expect(res.cookie).not.toHaveBeenCalled();
    expect(r).toMatchObject({ refresh_token: 'refresh-secret', access_token: 'access' });
  });

  it('web refresh: reads the cookie only (a body token is ignored) and sets the cookie again', async () => {
    const { controller, authService, res } = build();
    const r = await controller.refresh(
      req({}, { sefay_refresh: 'cookie-token' }),
      res as never,
      { refresh_token: 'body-token' },
    );
    expect(authService.refresh).toHaveBeenCalledWith({ refresh_token: 'cookie-token' }, expect.anything(), expect.anything());
    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(r).not.toHaveProperty('refresh_token');
  });

  it('android refresh: reads the BODY token, returns the rotated token in the body, no cookie', async () => {
    const { controller, authService, res } = build();
    const r = await controller.refresh(
      req({ 'x-sefay-client': 'android' }),
      res as never,
      { refresh_token: 'body-token' },
    );
    expect(authService.refresh).toHaveBeenCalledWith({ refresh_token: 'body-token' }, expect.anything(), expect.anything());
    expect(res.cookie).not.toHaveBeenCalled();
    expect(r).toMatchObject({ refresh_token: 'refresh-secret-2' });
  });

  it('android refresh without a body token is 401 (a cookie is not accepted in this mode)', async () => {
    const { controller, authService, res } = build();
    await controller.refresh(
      req({ 'x-sefay-client': 'android' }, { sefay_refresh: 'cookie-token' }),
      res as never,
      {},
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(authService.refresh).not.toHaveBeenCalled();
  });

  it('the client header value is case-insensitive and any other value is treated as web', async () => {
    const { controller, res } = build();
    const a = await controller.login(LOGIN_DTO, req({ 'x-sefay-client': 'ANDROID' }), res as never);
    expect(a).toHaveProperty('refresh_token');
    const { controller: c2, res: res2 } = build();
    const b = await c2.login(LOGIN_DTO, req({ 'x-sefay-client': 'ios' }), res2 as never);
    expect(b).not.toHaveProperty('refresh_token');
    expect(res2.cookie).toHaveBeenCalled();
  });
});
