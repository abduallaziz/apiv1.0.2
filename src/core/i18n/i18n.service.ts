import { Injectable } from '@nestjs/common';
import * as ar_notifications from './locales/ar/notifications.json';
import * as en_notifications from './locales/en/notifications.json';
import * as ar_shift_report from './locales/ar/shift_report.json';
import * as en_shift_report from './locales/en/shift_report.json';

type LocaleNamespace = 'notifications' | 'shift_report';
type Lang = 'ar' | 'en';

const locales: Record<
  Lang,
  Record<LocaleNamespace, Record<string, unknown>>
> = {
  ar: { notifications: ar_notifications, shift_report: ar_shift_report },
  en: { notifications: en_notifications, shift_report: en_shift_report },
};

@Injectable()
export class I18nService {
  /**
   * Resolve language: user → tenant → system default 'en'
   */
  resolveLanguage(userLang?: string | null, tenantLang?: string | null): Lang {
    if (userLang === 'ar' || userLang === 'en') return userLang;
    if (tenantLang === 'ar' || tenantLang === 'en') return tenantLang;
    return 'en';
  }

  /**
   * Get a translation value by dot-path key.
   * Example: t('notifications', 'login_new_device.title', 'ar')
   */
  t(namespace: LocaleNamespace, key: string, lang: Lang = 'en'): string {
    const ns = locales[lang]?.[namespace] ?? locales['en'][namespace];
    const value = this.resolvePath(ns, key);
    if (typeof value === 'string') return value;
    // fallback to 'en'
    if (lang !== 'en') {
      const fallback = this.resolvePath(locales['en'][namespace], key);
      if (typeof fallback === 'string') return fallback;
    }
    return key;
  }

  /**
   * A whole namespace for `lang`, English filling any missing key. Used by
   * server-rendered documents (e.g. the register close report PDF) that need
   * every label at once.
   */
  bundle(namespace: LocaleNamespace, lang: Lang = 'en'): Record<string, unknown> {
    const merge = (
      base: Record<string, unknown>,
      over: Record<string, unknown>,
    ): Record<string, unknown> => {
      const out: Record<string, unknown> = { ...base };
      for (const [k, v] of Object.entries(over)) {
        const b = out[k];
        out[k] =
          v && typeof v === 'object' && b && typeof b === 'object'
            ? merge(b as Record<string, unknown>, v as Record<string, unknown>)
            : v;
      }
      return out;
    };
    const en = locales['en'][namespace];
    const own = locales[lang]?.[namespace] ?? {};
    return lang === 'en' ? { ...en } : merge(en, own);
  }

  /**
   * Interpolate template variables.
   * Example: interpolate('Hello {{name}}', { name: 'Ahmad' }) → 'Hello Ahmad'
   */
  interpolate(template: string, data: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
      const val = data[k];
      return val !== undefined && val !== null ? String(val) : '';
    });
  }

  /**
   * Get translated + interpolated notification template.
   * Returns { title, body }
   */
  notification(
    type: string,
    data: Record<string, unknown> = {},
    lang: Lang = 'en',
  ): { title: string; body: string } {
    const title = this.interpolate(
      this.t('notifications', `${type}.title`, lang),
      data,
    );
    const body = this.interpolate(
      this.t('notifications', `${type}.body`, lang),
      data,
    );
    return { title, body };
  }

  private resolvePath(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object')
        return (acc as Record<string, unknown>)[key];
      return undefined;
    }, obj);
  }
}
