// Purchasing #9.5.6.1: Agreements backend regression suite.
// Not wired into CI (api.yml only runs `npm run build`) — run deliberately
// via `npm test`. Mirrors rfq-award.regression.spec.ts style: real
// Supabase client (service-role key), services instantiated by hand
// (bypasses Nest DI), created rows torn down in afterAll.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { AgreementsService } from '../agreements.service';
import { AgreementsRepository } from '../repositories/agreements.repository';
import { ApprovalEngine } from '../../../engines/approval-engine/approval.engine';
import { ApprovalHistoryRepository } from '../../../engines/approval-engine/approval-history.repository';

dotenv.config();

// "Sefay Demo" — the shared dev tenant used by every other regression spec.
const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf';

describe('Agreements module (migrations 128-135)', () => {
  let supabase: SupabaseClient;
  let service: AgreementsService;
  let supplierId: string;
  let itemId: string;
  let userAId: string;
  let userBId: string;
  const cleanup: { agreements: string[] } = { agreements: [] };

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    service = new AgreementsService(
      new AgreementsRepository(supabase),
      new ApprovalEngine(),
      new ApprovalHistoryRepository(supabase),
    );

    const { data: supplier } = await supabase
      .from('suppliers')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1)
      .single();
    supplierId = supplier!.id;

    const { data: item } = await supabase
      .from('items')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1)
      .single();
    itemId = item!.id;

    const { data: users } = await supabase
      .from('users')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(2);
    userAId = users![0].id;
    userBId = users![1]?.id ?? users![0].id;
  });

  afterAll(async () => {
    if (cleanup.agreements.length) {
      await supabase.from('agreements').delete().in('id', cleanup.agreements);
    }
  });

  it('creates a draft agreement with items', async () => {
    const agreement = await service.create(
      TEST_TENANT_ID,
      {
        supplier_id: supplierId,
        agreement_number: `REG-AGR-${Date.now()}`,
        items: [{ item_id: itemId, committed_quantity: 100 }],
      },
      userAId,
    );
    cleanup.agreements.push(agreement.id);
    expect(agreement.status).toBe('draft');
    expect(agreement.items).toHaveLength(1);
  });

  it('rejects approve on a draft agreement (not yet submitted)', async () => {
    const agreement = await service.create(
      TEST_TENANT_ID,
      {
        supplier_id: supplierId,
        agreement_number: `REG-AGR-${Date.now()}`,
        items: [{ item_id: itemId, committed_quantity: 10 }],
      },
      userAId,
    );
    cleanup.agreements.push(agreement.id);
    await expect(
      service.approve(agreement.id, TEST_TENANT_ID, userBId),
    ).rejects.toThrow('Cannot approve agreement with status: draft');
  });

  it('drives the full lifecycle: draft -> submitted -> approved -> closed, with history logged at every step', async () => {
    const agreement = await service.create(
      TEST_TENANT_ID,
      {
        supplier_id: supplierId,
        agreement_number: `REG-AGR-${Date.now()}`,
        items: [{ item_id: itemId, committed_quantity: 50 }],
      },
      userAId,
    );
    cleanup.agreements.push(agreement.id);

    const submitted = await service.submit(
      agreement.id,
      TEST_TENANT_ID,
      userAId,
    );
    expect(submitted.status).toBe('submitted');

    const approved = await service.approve(
      agreement.id,
      TEST_TENANT_ID,
      userBId,
    );
    expect(approved.status).toBe('approved');
    expect(approved.approved_by).toBe(userBId);

    const closed = await service.close(agreement.id, TEST_TENANT_ID, userBId);
    expect(closed.status).toBe('closed');

    const history = await service.history(agreement.id, TEST_TENANT_ID);
    const actions = history.map((h: any) => h.action);
    expect(actions).toEqual(['submitted', 'approved', 'closed']);
  }, 20000);

  it('rejects a submitted agreement and records the reason', async () => {
    const agreement = await service.create(
      TEST_TENANT_ID,
      {
        supplier_id: supplierId,
        agreement_number: `REG-AGR-${Date.now()}`,
        items: [{ item_id: itemId, committed_quantity: 20 }],
      },
      userAId,
    );
    cleanup.agreements.push(agreement.id);

    await service.submit(agreement.id, TEST_TENANT_ID, userAId);
    const rejected = await service.reject(
      agreement.id,
      TEST_TENANT_ID,
      userBId,
      { reason: 'Pricing not competitive' },
    );
    expect(rejected.status).toBe('rejected');
    expect(rejected.notes).toContain('Pricing not competitive');
  });

  it('rejects editing a non-draft agreement', async () => {
    const agreement = await service.create(
      TEST_TENANT_ID,
      {
        supplier_id: supplierId,
        agreement_number: `REG-AGR-${Date.now()}`,
        items: [{ item_id: itemId, committed_quantity: 5 }],
      },
      userAId,
    );
    cleanup.agreements.push(agreement.id);
    await service.submit(agreement.id, TEST_TENANT_ID, userAId);
    await expect(
      service.update(agreement.id, TEST_TENANT_ID, { notes: 'edited' }),
    ).rejects.toThrow('Only draft agreements can be edited');
  });

  it('rejects deleting a non-draft agreement, but allows deleting a draft one', async () => {
    const agreement = await service.create(
      TEST_TENANT_ID,
      {
        supplier_id: supplierId,
        agreement_number: `REG-AGR-${Date.now()}`,
        items: [{ item_id: itemId, committed_quantity: 5 }],
      },
      userAId,
    );
    await service.submit(agreement.id, TEST_TENANT_ID, userAId);
    await expect(service.remove(agreement.id, TEST_TENANT_ID)).rejects.toThrow(
      'Only draft agreements can be deleted',
    );

    // cancel it back to a deletable state is not supported by design
    // (cancelled, not draft) -- confirm a genuinely fresh draft can be
    // deleted instead, and clean this one up directly.
    cleanup.agreements.push(agreement.id);

    const draftAgreement = await service.create(
      TEST_TENANT_ID,
      {
        supplier_id: supplierId,
        agreement_number: `REG-AGR-${Date.now()}`,
        items: [{ item_id: itemId, committed_quantity: 5 }],
      },
      userAId,
    );
    await service.remove(draftAgreement.id, TEST_TENANT_ID);
    const { data: stillThere } = await supabase
      .from('agreements')
      .select('id')
      .eq('id', draftAgreement.id)
      .is('deleted_at', null)
      .maybeSingle();
    expect(stillThere).toBeNull();
  }, 20000);

  it('enforces tenant isolation: an agreement from another tenant is not visible', async () => {
    const agreement = await service.create(
      TEST_TENANT_ID,
      {
        supplier_id: supplierId,
        agreement_number: `REG-AGR-${Date.now()}`,
        items: [{ item_id: itemId, committed_quantity: 5 }],
      },
      userAId,
    );
    cleanup.agreements.push(agreement.id);

    const otherTenantId = '00000000-0000-0000-0000-00000000dead';
    await expect(service.findById(agreement.id, otherTenantId)).rejects.toThrow(
      'Agreement not found',
    );
  });
});
