import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

// Flags that make headless Chrome run inside a locked-down container (Railway).
export const CHROME_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-zygote',
];

// Side-effect surface of the resolver, injectable so it can be unit-tested.
export interface ChromeFs {
  exists(p: string): boolean;
  readdir(p: string): string[];
  which(name: string): string | null;
}

export const realChromeFs: ChromeFs = {
  exists: (p) => fs.existsSync(p),
  readdir: (p) => {
    try {
      return fs.readdirSync(p);
    } catch {
      return [];
    }
  },
  which: (name) => {
    try {
      const out = execFileSync('which', [name], {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return out || null;
    } catch {
      return null;
    }
  },
};

export interface ChromeResolution {
  path: string | null;
  source: string;
  tried: string[];
}

const STATIC_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/run/current-system/sw/bin/chromium',
  '/root/.nix-profile/bin/chromium',
  '/nix/var/nix/profiles/default/bin/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

// Resolve a Chrome/Chromium executable through several strategies, in order:
// env var, well-known paths, PATH scan, `which`, nix store glob, puppeteer cache.
export function resolveChromeExecutable(
  env: NodeJS.ProcessEnv = process.env,
  io: ChromeFs = realChromeFs,
  platform: string = process.platform,
): ChromeResolution {
  const tried: string[] = [];
  const check = (p: string | undefined | null, source: string) => {
    if (!p) return null;
    tried.push(p);
    return io.exists(p) ? { path: p, source, tried } : null;
  };

  for (const key of ['PUPPETEER_EXECUTABLE_PATH', 'CHROME_PATH'] as const) {
    const hit = check(env[key], `env:${key}`);
    if (hit) return hit;
  }
  for (const c of STATIC_CANDIDATES) {
    const hit = check(c, 'well-known path');
    if (hit) return hit;
  }

  const names =
    platform === 'win32'
      ? ['chrome.exe']
      : ['chromium', 'chromium-browser', 'google-chrome'];
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const hit = check(path.join(dir, name), 'PATH scan');
      if (hit) return hit;
    }
  }

  if (platform !== 'win32') {
    for (const name of names) {
      const w = io.which(name);
      const hit = check(w, 'which');
      if (hit) return hit;
    }
    // nix store: /nix/store/<hash>-chromium-<ver>/bin/chromium
    for (const entry of io.readdir('/nix/store')) {
      if (!/-chromium-\d/.test(entry) || /-unwrapped|-sandbox/.test(entry)) {
        continue;
      }
      const hit = check(`/nix/store/${entry}/bin/chromium`, 'nix store');
      if (hit) return hit;
    }
    // puppeteer download cache
    const cacheRoots = [
      env.PUPPETEER_CACHE_DIR,
      env.HOME ? path.posix.join(env.HOME, '.cache', 'puppeteer') : undefined,
      '/root/.cache/puppeteer',
    ];
    for (const root of cacheRoots) {
      if (!root) continue;
      for (const kind of ['chrome', 'chrome-headless-shell']) {
        for (const ver of io.readdir(path.posix.join(root, kind))) {
          for (const bin of [
            path.posix.join(root, kind, ver, 'chrome-linux64', 'chrome'),
            path.posix.join(
              root,
              kind,
              ver,
              'chrome-headless-shell-linux64',
              'chrome-headless-shell',
            ),
          ]) {
            const hit = check(bin, 'puppeteer cache');
            if (hit) return hit;
          }
        }
      }
    }
  }
  return { path: null, source: 'none', tried };
}
