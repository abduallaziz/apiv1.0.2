import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TenantContext } from '../../core/tenant/tenant-context';
import { TenantSessionService } from '../../core/tenant/tenant-session.service';
import { AssetsService } from './assets.service';
import { TemplatesService } from './templates.service';

type Obj = Record<string, unknown>;

const dir = join(__dirname, 'default-assets');
const png = (name: string): Express.Multer.File => {
  const buffer = readFileSync(join(dir, name));
  return {
    buffer,
    size: buffer.length,
    originalname: name,
    mimetype: 'image/png',
  } as Express.Multer.File;
};

/**
 * Every tenant gets the "عرض سعر" quotation design as a ready, published, default template the
 * first time it opens the document builder. The logo is a placeholder ("ضع شعارك هنا") the tenant
 * replaces from the asset library; nothing here carries any brand, stamp or signature.
 *
 * Lazy on purpose (instead of at sign-up): it needs the builder switched on, it must not slow or
 * break registration, and it also serves tenants that existed before the builder did.
 */
@Injectable()
export class DefaultTemplateService {
  private readonly logger = new Logger(DefaultTemplateService.name);
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly tenantSession: TenantSessionService,
    private readonly assets: AssetsService,
    private readonly templates: TemplatesService,
  ) {}

  /** Idempotent: does nothing once the tenant has ever had a template (even a deleted one). */
  ensure(tenant: TenantContext, userId: string): Promise<void> {
    const tenantId = tenant.tenantId;
    const running = this.inFlight.get(tenantId);
    if (running !== undefined) return running;
    const job = this.run(tenant, userId)
      .then(() => undefined)
      .catch((e: unknown) => {
        // never block the builder: the tenant can still make its own templates
        this.logger.warn(
          `default template provisioning failed: ${e instanceof Error ? e.message : JSON.stringify(e)}`,
        );
      })
      .finally(() => this.inFlight.delete(tenantId));
    this.inFlight.set(tenantId, job);
    return job;
  }

  /**
   * Explicit "create the default templates" action. Unlike the lazy ensure() it also works for a
   * tenant that once had templates, but only while it has NO live template at all, so it can never
   * duplicate or override templates the tenant is using. Returns whether anything was created.
   */
  async restore(tenant: TenantContext, userId: string): Promise<boolean> {
    const tenantId = tenant.tenantId;
    const running = this.inFlight.get(tenantId);
    if (running !== undefined) {
      await running;
      return false;
    }
    const job = this.run(tenant, userId, true);
    this.inFlight.set(
      tenantId,
      job.then(
        () => undefined,
        () => undefined,
      ),
    );
    try {
      return await job;
    } finally {
      this.inFlight.delete(tenantId);
    }
  }

  private async run(
    tenant: TenantContext,
    userId: string,
    onlyIfNoLiveTemplates = false,
  ): Promise<boolean> {
    const seen = await this.tenantSession.runInTenantContext(
      tenant,
      async (client) => {
        const r = await client.query(
          `SELECT 1 FROM document_templates WHERE tenant_id = $1
            ${onlyIfNoLiveTemplates ? 'AND deleted_at IS NULL' : ''} LIMIT 1`,
          [tenant.tenantId],
        );
        return r.rows.length > 0;
      },
    );
    if (seen) return false;

    const up = async (name: string, category: 'image' | 'logo', file: string) =>
      (await this.assets.create(
        tenant,
        userId,
        { name, category },
        png(file),
      )) as { id: string };
    const a = {
      corner: await up('زاوية الترويسة', 'image', 'corner.png'),
      skyline: await up('أفق المدينة', 'image', 'skyline.png'),
      deco: await up('زخرفة العنوان', 'image', 'deco.png'),
      frame: await up('إطار QR', 'image', 'frame.png'),
      logo: await up('ضع شعارك هنا', 'logo', 'logo-placeholder.png'),
      logoEn: await up(
        'Place your logo here',
        'logo',
        'logo-placeholder-en.png',
      ),
    };

    // one template per language: Arabic (the default) and English
    for (const lang of ['ar', 'en'] as const) {
      const created = (await this.templates.create(tenant, userId, {
        doc_type: 'quotation',
        name: lang === 'ar' ? 'عرض سعر' : 'Quotation',
        description:
          lang === 'ar'
            ? 'القالب الافتراضي لعرض السعر (عربي)'
            : 'Default quotation template (English)',
        paper: 'A4',
        orientation: 'portrait',
        body: defaultQuotationBody(
          {
            corner: a.corner.id,
            skyline: a.skyline.id,
            deco: a.deco.id,
            frame: a.frame.id,
            logo: lang === 'ar' ? a.logo.id : a.logoEn.id,
          },
          lang,
        ),
      } as never)) as { id: string };
      await this.templates.publish(tenant, created.id);
      if (lang === 'ar') await this.templates.setDefault(tenant, created.id);
    }
    return true;
  }
}

interface AssetIds {
  corner: string;
  skyline: string;
  deco: string;
  frame: string;
  logo: string;
}

const ov = (
  id: string,
  type: string,
  assetId: string | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Obj = {},
): Obj => ({
  id,
  type,
  region: 'overlay',
  page: 0,
  ...(assetId ? { assetId } : {}),
  position: { x, y },
  size: { width: w, height: h },
  rotation: 0,
  opacity: 1,
  zIndex: 1,
  visible: true,
  locked: false,
  maintainAspect: true,
  ...extra,
});
const fl = (
  id: string,
  type: string,
  config: Obj | undefined,
  extra: Obj = {},
): Obj => ({
  id,
  type,
  region: 'flow',
  page: 0,
  ...(config ? { config } : {}),
  ...extra,
});

const card = {
  bg: '#FFFFFF',
  border: '#7FB3E0',
  borderWidth: 0.4,
  radius: 5,
  padding: 2.5,
};

type Lang = 'ar' | 'en';

const TEXT = {
  ar: {
    title: 'عرض سعر',
    subtitle: 'Quotation',
    greet1: 'السادة / {{customer.name}} المحترمين،',
    greet2:
      'يسرنا أن نقدم لكم عرض السعر التالي لتنفيذ الخدمات المطلوبة، وفقاً للتفاصيل والشروط الموضحة أدناه:',
    cols: ['م', 'الصنف / الخدمة', 'الوصف', 'الكمية', 'سعر الوحدة', 'الإجمالي'],
    termsTitle: 'شروط وأحكام العرض',
    terms:
      '• هذا العرض ساري لمدة 30 يوماً من تاريخ إصداره.\n• الأسعار الموضحة أعلاه لا تشمل أي خدمات أو أعمال إضافية خارج نطاق العرض.\n• يتم السداد وفقاً للاتفاق: 50% مقدماً و50% بعد التسليم النهائي للخدمات.\n• يخضع هذا العرض لشروط وأحكام الشركة المعتمدة.',
    qrCap: 'امسح الرمز للاطلاع على نسخة إلكترونية من العرض',
    closing: 'مع خالص التحية،\n{{company.name}}',
    signer: 'اسم المسؤول\nالمسمى الوظيفي',
  },
  en: {
    title: 'Quotation',
    subtitle: 'عرض سعر',
    greet1: 'Dear {{customer.name}},',
    greet2:
      'We are pleased to submit the following quotation for the requested services, according to the details and terms below:',
    cols: ['#', 'Item / Service', 'Description', 'Qty', 'Unit price', 'Total'],
    termsTitle: 'Terms & Conditions',
    terms:
      '• This quotation is valid for 30 days from the date of issue.\n• The prices above do not include any services or work outside the scope of this quotation.\n• Payment as agreed: 50% in advance and 50% upon final delivery of the services.\n• This quotation is subject to the Company’s approved terms and conditions.',
    qrCap: 'Scan the code to view the electronic copy of this quotation',
    closing: 'Best regards,\n{{company.name}}',
    signer: 'Authorized name\nJob title',
  },
} as const;

/** The quotation design (blocks arranged in rows, decorative art, QR, signature texts). */
export function defaultQuotationBody(ids: AssetIds, lang: Lang = 'ar'): Obj {
  const t = TEXT[lang];
  return {
    pages: [
      {
        size: 'A4',
        orientation: 'portrait',
        marginsMm: { top: 10, right: 12, bottom: 60, left: 12 },
      },
    ],
    missingValue: 'dash',
    elements: [
      ov('corner', 'image', ids.corner, 0, 0, 36, 27, { anchor: 'every' }),
      ov('skyline', 'image', ids.skyline, 0, 267, 210, 30, { anchor: 'every' }),
      ov('logo', 'logo', ids.logo, 112, 5, 88, 31.7, { zIndex: 5 }),
      ov('vline', 'text_box', undefined, 104, 9, 0.5, 24, {
        zIndex: 4,
        maintainAspect: false,
        config: { text: '' },
        style: { bg: '#B8C4D0' },
      }),
      ov('deco', 'image', ids.deco, 36, 33.5, 138, 38, { zIndex: 2 }),

      fl(
        'contact',
        'company_info',
        {
          fields: ['phone', 'email', 'address'],
          labelMode: 'none',
          icons: true,
        },
        {
          // the logo sits on the right of the page in both languages: contact goes to the other side
          layout: { width: 46, place: lang === 'ar' ? 'end' : 'start' },
          style: { padding: 2, spaceBefore: 3, fontSize: 10 },
        },
      ),
      fl(
        'title',
        'heading',
        { text: t.title },
        {
          layout: { width: 50, place: 'center' },
          style: {
            bg: '#E8F0FA',
            color: '#0B2A55',
            radius: 12,
            padding: 2,
            align: 'center',
            fontSize: 32,
            weight: 'bold',
            spaceBefore: 2,
          },
        },
      ),
      fl(
        'subtitle',
        'heading',
        { text: t.subtitle },
        {
          layout: { width: 50, place: 'center' },
          style: {
            color: '#4B6784',
            align: 'center',
            fontSize: 16,
            weight: 'bold',
            spaceBefore: 2,
          },
        },
      ),
      fl(
        'docinfo',
        'document_info',
        {
          fields: ['number', 'date', 'valid_until'],
          icons: true,
          rowBg: '#EAF2FB',
        },
        { layout: { width: 49 }, style: { ...card, spaceBefore: 6 } },
      ),
      fl(
        'customer',
        'customer_info',
        { fields: ['name', 'phone', 'email'], icons: true, rowBg: '#EAF2FB' },
        { layout: { sideBySide: true, width: 49 }, style: { ...card } },
      ),
      fl(
        'greet1',
        'text',
        { text: t.greet1 },
        { style: { spaceBefore: 6, weight: 'bold', fontSize: 12 } },
      ),
      fl(
        'greet2',
        'text',
        { text: t.greet2 },
        { style: { spaceBefore: 1, fontSize: 10 } },
      ),
      fl(
        'items',
        'items_table',
        {
          zebra: false,
          repeatHeader: true,
          headerBg: '#0F4C81',
          showCurrency: true,
          grid: true,
          columns: [
            { key: 'index', label: t.cols[0], width: 5, align: 'center' },
            { key: 'name', label: t.cols[1], width: 20, bold: true },
            { key: 'description', label: t.cols[2], width: 33 },
            { key: 'quantity', label: t.cols[3], width: 9, align: 'center' },
            { key: 'unit_price', label: t.cols[4], width: 17 },
            { key: 'total', label: t.cols[5], width: 16 },
          ],
        },
        {
          style: {
            spaceBefore: 3,
            border: '#BFD7EE',
            borderWidth: 0.3,
            radius: 3,
          },
        },
      ),
      fl(
        'totals',
        'totals',
        {
          accent: '#0F7C86',
          accentValue: '#0F4C81',
          labelBg: '#E4EEF8',
          showCurrency: true,
        },
        {
          layout: { width: 52 },
          style: {
            spaceBefore: 6,
            border: '#BFD7EE',
            borderWidth: 0.3,
            radius: 3,
          },
        },
      ),
      fl(
        'terms',
        'terms',
        {
          title: t.termsTitle,
          titleBg: '#0F4C81',
          bulletColor: '#14B8A6',
          text: t.terms,
        },
        {
          layout: { sideBySide: true, width: 46, divider: true },
          style: { fontSize: 9, spaceBefore: 0 },
        },
      ),

      ov('qr-frame', 'image', ids.frame, 12, 233, 36, 36, { zIndex: 7 }),
      ov('qr', 'qr', undefined, 17, 238, 26, 26, {
        zIndex: 8,
        config: { kind: 'verification' },
      }),
      ov('qr-cap', 'text_box', undefined, 50, 241, 32, 20, {
        zIndex: 8,
        maintainAspect: false,
        config: { text: t.qrCap },
        style: { fontSize: 7.5, color: '#3E5C7A', align: 'start' },
      }),
      ov('closing', 'text_box', undefined, 84, 231, 62, 13, {
        zIndex: 8,
        maintainAspect: false,
        config: { text: t.closing },
        style: {
          fontSize: 10,
          color: '#0B2A55',
          align: 'center',
          weight: 'bold',
        },
      }),
      ov('signer', 'text_box', undefined, 84, 255, 62, 11, {
        zIndex: 8,
        maintainAspect: false,
        config: { text: t.signer },
        style: {
          fontSize: 10,
          color: '#0B2A55',
          align: 'center',
          weight: 'bold',
        },
      }),
    ],
  };
}
