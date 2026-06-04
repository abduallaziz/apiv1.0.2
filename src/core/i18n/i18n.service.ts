import { Injectable } from '@nestjs/common';
import * as ar_notifications from './locales/ar/notifications.json';
import * as en_notifications from './locales/en/notifications.json';

type LocaleNamespace = 'notifications';
type Lang = 'ar' | 'en';

const locales: Record<Lang, Record<LocaleNamespace, Record<string, unknown>>> = {
  ar: { notifications: ar_notifications as Record<string, unknown> },
  en: { notifications: en_notifications as Record<string, unknown> },
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
    const title = this.interpolate(this.t('notifications', `${type}.title`, lang), data);
    const body = this.interpolate(this.t('notifications', `${type}.body`, lang), data);
    return { title, body };
  }

  private resolvePath(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
      return undefined;
    }, obj);
  }
}