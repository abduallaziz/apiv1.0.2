// Purchasing #9.5.6.3: Releases backend regression suite.
// Not wired into CI (api.yml only runs `npm run build`) -- run deliberately
// via `npm test`. Mirrors amendments.regression.spec.ts style: real
// Supabase client (service-role key), services instantiated by hand
// (bypasses Nest DI), created rows torn down in afterAll.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { ReleasesService } from '../releases.service';
import { ReleasesRepository } from '../repositories/releases.repository';
import { AgreementsRepository } from '../repositories/agreements.repository';
import { ApprovalEngine } from '../../../engines/approval-engine/approval.engine';
import { ApprovalHistoryRepository } from '../../../engines/approval-engine/approval-history.repository';
import { DiscountEngine } from '../../../engines/discount-engine/discount.engine';

dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf';

describe('Releases module (migrations 128-133, 138)', () => {
  let supabase: SupabaseClient;
  let service: ReleasesService;
  let supplierId: string;
  let itemId: string;
  let userAId: string;
  let userBId: string;
  const cleanup: {
    agreements: string[];
    agreementItems: string[];
    pricing: string[];
    releases: string[];
  } = { agreements: [], agreementItems: [], pricing: [], releases: [] };

  async function makeAgreement(status = 'approved') {
    const { data, error } = await supabase
      .from('agreements')
      .insert({
        tenant_id: TEST_TENANT_ID,
        supplier_id: supplierId,
        agreement_number: `REG-REL-AGR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        status,
      })
      .select()
      .single();
    if (error) throw error;
    cleanup.agreements.push(data.id);
    return data;
  }

  async function makeAgreementItem(
    agreementId: string,
    qty: number | null = 100,
  ) {
    const { data, error } = await supabase
      .from('agreement_items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        agreement_id: agreementId,
        item_id: itemId,
        committed_quantity: qty,
      })
      .select()
      .single();
    if (error) throw error;
    cleanup.agreementItems.push(data.id);
    return data;
  }

  async function makePricing(agreementItemId: string, unitPrice = 10) {
    const { data, error } = await supabase
      .from('agreement_pricing')
      .insert({
        tenant_id: TEST_TENANT_ID,
        agreement_item_id: agreementItemId,
        pricing_type: 'fixed',
        unit_price: unitPrice,
      })
      .select()
      .single();
    if (error) throw error;
    cleanup.pricing.push(data.id);
    return data;
  }

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    service = new ReleasesService(
      new ReleasesRepository(supabase),
      new AgreementsRepository(supabase),
      new ApprovalEngine(),
      new ApprovalHistoryRepository(supabase),
      new DiscountEngine(),
    );

    const { data: supplier } = await supabase
      .from('suppliers')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1)
      .single();
    supplierId = supplier.id;

    const { data: items } = await supabase
      .from('items')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1);
    itemId = items[0].id;

    const { data: users } = await supabase
      .from('users')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(2);
    userAId = users[0].id;
    userBId = users[1]?.id ?? users[0].id;
  });

  afterAll(async () => {
    if (cleanup.releases.length) {
      await supabase
        .from('agreement_releases')
        .delete()
        .in('id', cleanup.releases);
    }
    if (cleanup.pricing.length) {
      await supabase
        .from('agreement_pricing')
        .delete()
        .in('id', cleanup.pricing);
    }
    if (cleanup.agreementItems.length) {
      await supabase
        .from('agreement_items')
        .delete()
        .in('id', cleanup.agreementItems);
    }
    if (cleanup.agreements.length) {
      await supabase.from('agreements').delete().in('id', cleanup.agreements);
    }
  });

  it('creates a release successfully within the committed limit, with a server-computed snapshot', async () => {
    const agreement = await makeAgreement('approved');
    const agreementItem = await makeAgreementItem(agreement.id, 100);
    await makePricing(agreementItem.id, 10);

    const release: any = await service.create(
      TEST_TENANT_ID,
      {
        agreement_id: agreement.id,
        release_number: `REG-REL-${Date.now()}`,
        items: [{ agreement_item_id: agreementItem.id, released_quantity: 10 }],
      },
      userAId,
    );
    cleanup.releases.push(release.id);

    expect(release.status).toBe('draft');
    expect(release.items).toHaveLength(1);
    expect(Number(release.items[0].snapshot_unit_price)).toBe(10);
    expect(Number(release.items[0].released_amount)).toBe(100);
  }, 20000);

  it('rejects a release that exceeds the remaining committed quantity (overage_policy=block)', async () => {
    const agreement = await makeAgreement('approved');
    const agreementItem = await makeAgreementItem(agreement.id, 50);
    await makePricing(agreementItem.id, 10);

    let thrown: Error | undefined;
    try {
      await service.create(
        TEST_TENANT_ID,
        {
          agreement_id: agreement.id,
          release_number: `REG-REL-${Date.now()}`,
          items: [
            { agreement_item_id: agreementItem.id, released_quantity: 51 },
          ],
        },
        userAId,
      );
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown?.message).toContain('exceeds remaining committed quantity');
  }, 20000);

  it('allows an open-ended (Open Blanket) agreement_item to release any quantity, skipping the overage check', async () => {
    const agreement = await makeAgreement('approved');
    const agreementItem = await makeAgreementItem(agreement.id, null);
    await makePricing(agreementItem.id, 5);

    const release: any = await service.create(
      TEST_TENANT_ID,
      {
        agreement_id: agreement.id,
        release_number: `REG-REL-${Date.now()}`,
        items: [
          { agreement_item_id: agreementItem.id, released_quantity: 99999 },
        ],
      },
      userAId,
    );
    cleanup.releases.push(release.id);
    expect(release.status).toBe('draft');
  }, 20000);

  it('keeps the snapshot isolated from later agreement_pricing changes', async () => {
    const agreement = await makeAgreement('approved');
    const agreementItem = await makeAgreementItem(agreement.id, 100);
    const pricing = await makePricing(agreementItem.id, 20);

    const release: any = await service.create(
      TEST_TENANT_ID,
      {
        agreement_id: agreement.id,
        release_number: `REG-REL-${Date.now()}`,
        items: [{ agreement_item_id: agreementItem.id, released_quantity: 5 }],
      },
      userAId,
    );
    cleanup.releases.push(release.id);
    expect(Number(release.items[0].released_amount)).toBe(100);

    await supabase
      .from('agreement_pricing')
      .update({ unit_price: 999 })
      .eq('id', pricing.id);

    const reread: any = await service.findById(release.id, TEST_TENANT_ID);
    expect(Number(reread.items[0].snapshot_unit_price)).toBe(20);
    expect(Number(reread.items[0].released_amount)).toBe(100);
  }, 20000);

  it('rolls back the entire release atomically if one item is invalid -- no orphan header left behind', async () => {
    const agreementA = await makeAgreement('approved');
    const agreementB = await makeAgreement('approved');
    const itemA = await makeAgreementItem(agreementA.id, 100);
    const itemB = await makeAgreementItem(agreementB.id, 100); // belongs to a DIFFERENT agreement
    await makePricing(itemA.id, 10);
    await makePricing(itemB.id, 10);

    const releaseNumber = `REG-REL-ORPHAN-${Date.now()}`;
    let thrown: Error | undefined;
    try {
      await service.create(
        TEST_TENANT_ID,
        {
          agreement_id: agreementA.id,
          release_number: releaseNumber,
          items: [
            { agreement_item_id: itemA.id, released_quantity: 5 },
            { agreement_item_id: itemB.id, released_quantity: 5 }, // wrong agreement
          ],
        },
        userAId,
      );
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeDefined();

    const { data: orphanCheck } = await supabase
      .from('agreement_releases')
      .select('id')
      .eq('release_number', releaseNumber);
    expect(orphanCheck).toHaveLength(0);
  }, 20000);

  it('drives the lifecycle submit -> approve, recording approval_history from the Service (no RPC in approve)', async () => {
    const agreement = await makeAgreement('approved');
    const agreementItem = await makeAgreementItem(agreement.id, 100);
    await makePricing(agreementItem.id, 10);

    const release: any = await service.create(
      TEST_TENANT_ID,
      {
        agreement_id: agreement.id,
        release_number: `REG-REL-${Date.now()}`,
        items: [{ agreement_item_id: agreementItem.id, released_quantity: 10 }],
      },
      userAId,
    );
    cleanup.releases.push(release.id);

    const submitted: any = await service.submit(
      release.id,
      TEST_TENANT_ID,
      userAId,
    );
    expect(submitted.status).toBe('submitted');

    const approved: any = await service.approve(
      release.id,
      TEST_TENANT_ID,
      userBId,
    );
    expect(approved.status).toBe('approved');

    const history = await service.history(release.id, TEST_TENANT_ID);
    const actions = history.map((h) => h.action);
    expect(actions).toEqual(['submitted', 'approved']);
  }, 20000);

  it('a subsequent release against the same item respects quantity already consumed by an approved release', async () => {
    const agreement = await makeAgreement('approved');
    const agreementItem = await makeAgreementItem(agreement.id, 20);
    await makePricing(agreementItem.id, 10);

    const first: any = await service.create(
      TEST_TENANT_ID,
      {
        agreement_id: agreement.id,
        release_number: `REG-REL-${Date.now()}`,
        items: [{ agreement_item_id: agreementItem.id, released_quantity: 15 }],
      },
      userAId,
    );
    cleanup.releases.push(first.id);
    await service.submit(first.id, TEST_TENANT_ID, userAId);
    await service.approve(first.id, TEST_TENANT_ID, userBId);

    let thrown: Error | undefined;
    try {
      await service.create(
        TEST_TENANT_ID,
        {
          agreement_id: agreement.id,
          release_number: `REG-REL-${Date.now()}`,
          items: [
            { agreement_item_id: agreementItem.id, released_quantity: 10 },
          ],
        },
        userAId,
      );
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown?.message).toContain('exceeds remaining committed quantity');
  }, 20000);

  it('enforces tenant isolation: a release from another tenant is not visible', async () => {
    const agreement = await makeAgreement('approved');
    const agreementItem = await makeAgreementItem(agreement.id, 100);
    await makePricing(agreementItem.id, 10);

    const release: any = await service.create(
      TEST_TENANT_ID,
      {
        agreement_id: agreement.id,
        release_number: `REG-REL-${Date.now()}`,
        items: [{ agreement_item_id: agreementItem.id, released_quantity: 5 }],
      },
      userAId,
    );
    cleanup.releases.push(release.id);

    const otherTenantId = '00000000-0000-0000-0000-00000000dead';
    let thrown: Error | undefined;
    try {
      await service.findById(release.id, otherTenantId);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown?.message).toBe('Release not found');
  }, 20000);

  it('fn_create_agreement_release rejects a cross-agreement item at the DB level, with zero orphan rows, even when called directly (bypassing Service validation)', async () => {
    const agreementA = await makeAgreement('approved');
    const agreementB = await makeAgreement('approved');
    const itemA = await makeAgreementItem(agreementA.id, 100);
    const itemB = await makeAgreementItem(agreementB.id, 100);

    const releaseNumber = `REG-REL-RPCORPHAN-${Date.now()}`;
    const rpc = await supabase.rpc('fn_create_agreement_release', {
      p_tenant_id: TEST_TENANT_ID,
      p_agreement_id: agreementA.id,
      p_release_number: releaseNumber,
      p_notes: null,
      p_effective_amendment_id: null,
      p_created_by: userAId,
      p_items: [
        {
          agreement_item_id: itemA.id,
          released_quantity: 5,
          snapshot_unit_price: 10,
          snapshot_discount_percent: 0,
          snapshot_currency: 'SAR',
          snapshot_tax_rate: null,
          released_amount: 50,
          source_pricing_tier_id: null,
          notes: null,
        },
        {
          agreement_item_id: itemB.id, // belongs to agreementB, not agreementA
          released_quantity: 5,
          snapshot_unit_price: 10,
          snapshot_discount_percent: 0,
          snapshot_currency: 'SAR',
          snapshot_tax_rate: null,
          released_amount: 50,
          source_pricing_tier_id: null,
          notes: null,
        },
      ],
    });

    expect(rpc.error).not.toBeNull();
    expect(rpc.error.message).toContain('does not belong to agreement');

    const { data: orphanCheck } = await supabase
      .from('agreement_releases')
      .select('id')
      .eq('release_number', releaseNumber);
    expect(orphanCheck).toHaveLength(0);
  }, 20000);
});
