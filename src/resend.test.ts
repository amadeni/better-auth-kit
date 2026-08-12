import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResendMagicLinkSender, resolveResendApiKey } from './resend.js';

const brand = {
  productName: 'Example App',
  from: 'Example App <noreply@mail.example.com>',
};

const verifyUrl =
  'https://app.example.com/api/auth/magic-link/verify?token=raw-token&callbackURL=%2F';

function fetchMock(response?: Partial<Response>) {
  return vi.fn(
    async () =>
      ({
        ok: true,
        json: async () => ({}),
        ...response,
      }) as Response,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveResendApiKey', () => {
  it('prefers AUTH_RESEND_KEY over AUTH_RESEND_API_KEY over RESEND_API_KEY', () => {
    expect(
      resolveResendApiKey({
        AUTH_RESEND_KEY: 'a',
        AUTH_RESEND_API_KEY: 'b',
        RESEND_API_KEY: 'c',
      }),
    ).toBe('a');
    expect(
      resolveResendApiKey({ AUTH_RESEND_API_KEY: 'b', RESEND_API_KEY: 'c' }),
    ).toBe('b');
    expect(resolveResendApiKey({ RESEND_API_KEY: 'c' })).toBe('c');
    expect(resolveResendApiKey({})).toBeUndefined();
  });
});

describe('createResendMagicLinkSender', () => {
  it('throws a clear error when no API key is configured', async () => {
    const send = createResendMagicLinkSender({ brand, fetchImpl: fetchMock() });
    await expect(
      send({ email: 'user@example.com', token: 'raw-token', url: verifyUrl }),
    ).rejects.toThrow(
      /AUTH_RESEND_KEY, AUTH_RESEND_API_KEY, or RESEND_API_KEY/,
    );
  });

  it('posts the branded email to the Resend REST API', async () => {
    vi.stubEnv('AUTH_RESEND_KEY', 're_test_key');
    const fetchImpl = fetchMock();
    const send = createResendMagicLinkSender({ brand, fetchImpl });

    await send({
      email: 'user@example.com',
      token: 'raw-token',
      url: verifyUrl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [target, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(target).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer re_test_key',
    );

    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.from).toBe(brand.from);
    expect(body.to).toBe('user@example.com');
    expect(body.subject).toContain('Example App Login Link (app.example.com)');
    // The email links to the interstitial login page, not the verify URL,
    // so mail scanners cannot consume the token.
    expect(body.html).toContain(
      'https://app.example.com/login?token=raw-token',
    );
    expect(body.html).not.toContain('magic-link/verify');
    expect(body.text).toContain(
      'https://app.example.com/login?token=raw-token',
    );
  });

  it('honors the key fallback chain from the process environment', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_fallback');
    const fetchImpl = fetchMock();
    const send = createResendMagicLinkSender({ brand, fetchImpl });

    await send({
      email: 'user@example.com',
      token: 'raw-token',
      url: verifyUrl,
    });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer re_fallback',
    );
  });

  it('supports a custom login URL builder', async () => {
    vi.stubEnv('AUTH_RESEND_KEY', 're_test_key');
    const fetchImpl = fetchMock();
    const send = createResendMagicLinkSender({
      brand,
      fetchImpl,
      buildLoginUrl: ({ token }) =>
        `https://app.example.com/anmelden?token=${token}`,
    });

    await send({
      email: 'user@example.com',
      token: 'raw-token',
      url: verifyUrl,
    });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.html).toContain(
      'https://app.example.com/anmelden?token=raw-token',
    );
  });

  it('throws with the Resend error payload on non-2xx responses', async () => {
    vi.stubEnv('AUTH_RESEND_KEY', 're_test_key');
    const fetchImpl = fetchMock({
      ok: false,
      json: async () => ({ name: 'validation_error' }),
    });
    const send = createResendMagicLinkSender({ brand, fetchImpl });

    await expect(
      send({ email: 'user@example.com', token: 'raw-token', url: verifyUrl }),
    ).rejects.toThrow(/Resend error: .*validation_error/);
  });
});
