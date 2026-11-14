import {
  CHROME_LAUNCH_ARGS,
  ChromeFs,
  resolveChromeExecutable,
} from './chrome-path';

const io = (over: Partial<ChromeFs> & { files?: string[] }): ChromeFs => ({
  exists: (p) => (over.files ?? []).includes(p),
  readdir: over.readdir ?? (() => []),
  which: over.which ?? (() => null),
});

describe('resolveChromeExecutable', () => {
  it('prefers the env var', () => {
    const r = resolveChromeExecutable(
      { PUPPETEER_EXECUTABLE_PATH: '/x/chrome' },
      io({ files: ['/x/chrome', '/usr/bin/chromium'] }),
      'linux',
    );
    expect(r.path).toBe('/x/chrome');
    expect(r.source).toBe('env:PUPPETEER_EXECUTABLE_PATH');
  });

  it('falls back to a well-known path', () => {
    const r = resolveChromeExecutable(
      { PUPPETEER_EXECUTABLE_PATH: '/missing' },
      io({ files: ['/usr/bin/chromium'] }),
      'linux',
    );
    expect(r.path).toBe('/usr/bin/chromium');
  });

  it('uses which when PATH scan misses', () => {
    const r = resolveChromeExecutable(
      {},
      io({
        files: ['/opt/c/chromium'],
        which: (n) => (n === 'chromium' ? '/opt/c/chromium' : null),
      }),
      'linux',
    );
    expect(r).toMatchObject({ path: '/opt/c/chromium', source: 'which' });
  });

  it('finds chromium in the nix store', () => {
    const p = '/nix/store/abc-chromium-120.0/bin/chromium';
    const r = resolveChromeExecutable(
      {},
      io({
        files: [p],
        readdir: (d) =>
          d === '/nix/store' ? ['abc-chromium-120.0', 'zzz-noto-fonts-1'] : [],
      }),
      'linux',
    );
    expect(r).toMatchObject({ path: p, source: 'nix store' });
  });

  it('finds the puppeteer cache', () => {
    const p = '/root/.cache/puppeteer/chrome/linux-1/chrome-linux64/chrome';
    const r = resolveChromeExecutable(
      {},
      io({
        files: [p],
        readdir: (d) =>
          d === '/root/.cache/puppeteer/chrome' ? ['linux-1'] : [],
      }),
      'linux',
    );
    expect(r).toMatchObject({ path: p, source: 'puppeteer cache' });
  });

  it('returns null with the tried list when nothing exists', () => {
    const r = resolveChromeExecutable({}, io({}), 'linux');
    expect(r.path).toBeNull();
    expect(r.tried.length).toBeGreaterThan(0);
  });
});

describe('CHROME_LAUNCH_ARGS', () => {
  it('contains the container-safe flags', () => {
    expect(CHROME_LAUNCH_ARGS).toEqual(
      expect.arrayContaining(['--no-sandbox', '--disable-dev-shm-usage']),
    );
  });
});
