import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type { Browser } from 'puppeteer-core';

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

  private resolveExecutable(): string | null {
    const fromEnv =
      process.env.PUPPETEER_EXECUTABLE_PATH ?? process.env.CHROME_PATH;
    const candidates = [
      fromEnv,
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ].filter((p): p is string => !!p);
    const found = candidates.find((p) => fs.existsSync(p));
    if (found) return found;
    // Last resort: a chromium / chrome binary on PATH (e.g. nixpacks).
    const names =
      process.platform === 'win32'
        ? ['chrome.exe']
        : ['chromium', 'chromium-browser', 'google-chrome'];
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      for (const name of names) {
        const full = path.join(dir, name);
        if (dir && fs.existsSync(full)) return full;
      }
    }
    return null;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    if (!this.launching) {
      const executablePath = this.resolveExecutable();
      if (!executablePath) {
        throw new ServiceUnavailableException(
          'PDF engine is not available on this server (no Chrome/Chromium found; set PUPPETEER_EXECUTABLE_PATH)',
        );
      }
      const puppeteer = await import('puppeteer-core');
      this.launching = puppeteer
        .launch({
          executablePath,
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
        })
        .then((b) => {
          this.browser = b;
          b.on('disconnected', () => {
            this.browser = null;
          });
          return b;
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
        const el = document.querySelector('.page') as HTMLElement | null;
        return el ? el.getBoundingClientRect().height : document.body.scrollHeight;
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
      throw e;
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
