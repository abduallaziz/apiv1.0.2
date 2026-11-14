import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Browser } from 'puppeteer-core';
import { CHROME_LAUNCH_ARGS, resolveChromeExecutable } from './chrome-path';

// Renders an HTML string to a real PDF with headless Chrome (puppeteer-core,
// owner-approved 2026-11-09: the most widely used option and the only one
// that shapes Arabic and orders mixed Arabic/English text correctly).
// The browser binary is NOT bundled: set PUPPETEER_EXECUTABLE_PATH (or
// CHROME_PATH) on the server; common install locations are tried otherwise.
@Injectable()
export class PdfRendererService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfRendererService.name);
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  // Which executable the engine will use (resolved once, logged once).
  private resolved: { path: string; source: string; args: string[] } | null =
    null;
  private resolveError: string | null = null;

  /**
   * Resolve a Chrome/Chromium binary: env var, well-known paths, PATH, `which`, nix store,
   * puppeteer cache, then (last resort) the serverless build shipped by @sparticuz/chromium.
   * A system chromium is preferred because it uses the installed fonts (Arabic shaping).
   */
  private async resolveExecutable(): Promise<{
    path: string;
    source: string;
    args: string[];
  } | null> {
    if (this.resolved) return this.resolved;
    const sys = resolveChromeExecutable();
    if (sys.path) {
      this.resolved = {
        path: sys.path,
        source: sys.source,
        args: [...CHROME_LAUNCH_ARGS],
      };
    } else {
      try {
        const mod = (await import('@sparticuz/chromium')) as {
          default: {
            executablePath: () => Promise<string>;
            args: string[];
          };
        };
        const exe = await mod.default.executablePath();
        this.resolved = {
          path: exe,
          source: '@sparticuz/chromium',
          args: Array.from(
            new Set([...mod.default.args, ...CHROME_LAUNCH_ARGS]),
          ),
        };
      } catch (e) {
        this.resolveError = `no Chrome found (tried ${sys.tried.length} paths) and @sparticuz/chromium failed: ${(e as Error).message}`;
        this.logger.error(`PDF engine unavailable: ${this.resolveError}`);
        return null;
      }
    }
    this.logger.log(
      `PDF engine: using ${this.resolved.path} (source: ${this.resolved.source})`,
    );
    return this.resolved;
  }

  /** Health probe: renders a tiny PDF and reports which executable was used. */
  async diagnose(): Promise<{
    status: 'ok' | 'down';
    executable: string | null;
    source: string | null;
    bytes?: number;
    detail?: string;
  }> {
    try {
      const pdf = await this.renderSinglePage(
        '<div class="page" style="padding:8px">PDF OK</div>',
      );
      return {
        status: 'ok',
        executable: this.resolved?.path ?? null,
        source: this.resolved?.source ?? null,
        bytes: pdf.length,
      };
    } catch (e) {
      return {
        status: 'down',
        executable: this.resolved?.path ?? null,
        source: this.resolved?.source ?? null,
        detail: this.resolveError ?? (e as Error).message,
      };
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    if (this.launching === null) {
      const resolved = await this.resolveExecutable();
      if (!resolved) {
        throw new ServiceUnavailableException(
          'PDF engine is not available on this server (no Chrome/Chromium found; set PUPPETEER_EXECUTABLE_PATH)',
        );
      }
      const puppeteer = await import('puppeteer-core').catch((e: unknown) => {
        this.logger.error('puppeteer import failed: ' + (e as Error).message);
        throw new ServiceUnavailableException('PDF engine is not available');
      });
      this.launching = puppeteer
        .launch({
          executablePath: resolved.path,
          headless: true,
          args: resolved.args,
          timeout: 30000,
        })
        .then((b) => {
          this.browser = b;
          b.on('disconnected', () => {
            this.browser = null;
          });
          return b;
        })
        .catch((e: unknown) => {
          // A browser that cannot start is a server-environment problem, not
          // a bug in the request: report it as 503 (not an opaque 500).
          const reason = e instanceof Error ? e.message : 'unknown error';
          this.logger.error(`Chrome launch failed: ${reason}`);
          // The reason is included (truncated, first line only) so a deployment problem can be
          // diagnosed from the UI without server logs.
          throw new ServiceUnavailableException(
            `PDF engine failed to start on this server: [${resolved.source}] ${reason.replace(/\s*\n\s*/g, ' | ').slice(0, 700)}`,
          );
        })
        .finally(() => {
          this.launching = null;
        });
    }
    return this.launching;
  }

  // One-page PDF, 105 mm wide, as tall as its content (.page element).
  async renderSinglePage(html: string, widthMm = 105): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      const heightPx = await page.evaluate(() => {
        const el = document.querySelector('.page');
        return el
          ? el.getBoundingClientRect().height
          : document.body.scrollHeight;
      });
      const heightMm = Math.max(40, Math.ceil((heightPx * 25.4) / 96) + 2);
      const pdf = await page.pdf({
        width: `${widthMm}mm`,
        height: `${heightMm}mm`,
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        pageRanges: '1',
      });
      return Buffer.from(pdf);
    } catch (e) {
      this.logger.error(`PDF render failed: ${(e as Error).message}`);
      if (e instanceof ServiceUnavailableException) throw e;
      throw new ServiceUnavailableException('PDF rendering failed');
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  // Generic document PDF (additive; renderSinglePage above is unchanged). The HTML carries its own
  // @page size, so Chrome paginates exactly as the template defines (used by the Document Builder).
  async renderDocument(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // 'load' waits for <img> resources, so stamps/logos are in the PDF
      await page.setContent(html, {
        waitUntil: 'load',
        timeout: 30000,
      });
      const pdf = await page.pdf({
        preferCSSPageSize: true,
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      return Buffer.from(pdf);
    } catch (e) {
      this.logger.error(`Document PDF render failed: ${(e as Error).message}`);
      throw e;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }
}
