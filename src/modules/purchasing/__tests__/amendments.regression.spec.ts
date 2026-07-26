// Purchasing #9.5.6.2: Amendments backend regression suite.
// Not wired into CI (api.yml only runs `npm run build`) -- run deliberately
// via `npm test`. Mirrors agreements.regression.spec.ts style: real
// Supabase client (service-role key), services instantiated by hand
// (bypasses Nest DI), created rows torn down in afterAll.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { AmendmentsService } from '../amendments.service';
import { AmendmentsRepository } from '../repositories/amendments.repository';
import { ApprovalEngine } from '../../../engines/approval-engine/approval.engine';
import { ApprovalHistoryRepository } from '../../../engines/approval-engine/approval-history.repository';

dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf';

describe('Amendments module (migrations 131, 136-137)', () => {
  let supabase: SupabaseClient;
  let service: AmendmentsService;
  let supplierId: string;
  let itemId: string;
  let item2Id: string;
  let userAId: string;
  let userBId: string;
  const cleanup: {
    agreements: string[];
    agreementItems: string[];
    amendments: string[];
  } = { agreements: [], agreementItems: [], amendments: [] };

  async function makeAgreement(status = 'approved') {
    const { data, error } = await supabase
      .from('agreements')
      .insert({
        tenant_id: TEST_TENANT_ID,
        supplier_id: supplierId,
        agreement_number: `REG-AMD-AGR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
    item = itemId,
    qty: number | null = 100,
    val: number | null = 1000,
  ) {
    const { data, error } = await supabase
      .from('agreement_items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        agreement_id: agreementId,
        item_id: item,
        committed_quantity: qty,
        committed_value: val,
      })
      .select()
      .single();
    if (error) throw error;
    cleanup.agreementItems.push(data.id);
    return data;
  }

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    service = new AmendmentsService(
      new AmendmentsRepository(supabase),
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

    const { data: items } = await supabase
      .from('items')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(2);
    itemId = items![0].id;
    item2Id = items![1]?.id ?? items![0].id;

    const { data: users } = await supabase
      .from('users')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(2);
    userAId = users![0].id;
    userBId = users![1]?.id ?? users![0].id;
  });

  afterAll(async () => {
    if (cleanup.amendments.length) {
      await supabase
        .from('agreement_amendments')
        .delete()
        .in('id', cleanup.amendments);
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

  it('rejects a commercial amendment_type when the agreement is not approved', async () => {
    const agreement = await makeAgreement('draft');
    await expect(
      service.create(
        TEST_TENANT_ID,
        {
          agreement_id: agreement.id,
          amendment_number: `REG-AMD-${Date.now()}`,
          amendment_type: 'quantity_change',
          items: [],
        } as any,
        userAId,
      ),
    ).rejects.toThrow(/must be approved/);
  });

  it('allows administrative_correction regardless of agreement status', async () => {
    const agreement = await makeAgreement('draft');
    const agreementItem = await makeAgreementItem(agreement.id);
    const amendment = await service.create(
      TEST_TENANT_ID,
      {
        agreement_id: agreement.id,
        amendment_number: `REG-AMD-${Date.now()}`,
        amendment_type: 'administrative_correction',
        items: [
          {
            action: 'modify',
            agreement_item_id: agreementItem.id,
            notes: 'typo fix',
          },
        ],
      } as any,
      userAId,
    );
    cleanup.amendments.push(amendment.id);
    expect(amendment.status).toBe('draft');
  });

  it('drives the full lifecycle: draft -> submitted -> approved, with modify/add/discontinue all applied atomically, and approval_history recorded exactly once', async () => {
    const agreement = await makeAgreement('approved');
    const modifyTarget = await makeAgreementItem(
      agreement.id,
      itemId,
      100,
      1000,
    );
    const discontinueTarget = await makeAgreementItem(
      agreement.id,
      item2Id,
      50,
      500,
    );

    const amendment = await service.create(
      TEST_TENANT_ID,
      {
        agreement_id: agreement.id,
        amendment_number: `REG-AMD-${Date.now()}`,
        amendment_type: 'quantity_change',
        items: [
          {
            action: 'modify',
            agreement_item_id: modifyTarget.id,
            delta_committed_quantity: 10,
            delta_committed_value: 100,
          },
          {
            action: 'add',
            item_id: item2Id === itemId ? itemId : item2Id,
            delta_committed_quantity: 25,
            delta_committed_value: 250,
          },
          { action: 'discontinue', agreement_item_id: discontinueTarget.id },
        ],
      } as any,
      userAId,
    );
    cleanup.amendments.push(amendment.id);
    expect(amendment.status).toBe('draft');

    // Pre-approve: the 'add' line must NOT have created any agreement_items row yet.
    const { data: beforeApprove } = await supabase
      .from('agreement_items')
      .select('id')
      .eq('added_via_amendment_id', amendment.id);
    expect(beforeApprove).toHaveLength(0);

    const submitted = await service.submit(
      amendment.id,
      TEST_TENANT_ID,
      userAId,
    );
    expect(submitted.status).toBe('submitted');

    const approved: any = await service.approve(
      amendment.id,
      TEST_TENANT_ID,
      userBId,
    );
    expect(approved.status).toBe('approved');

    // modify applied
    const { data: modifiedItem } = await supabase
      .from('agreement_items')
      .select('committed_quantity, committed_value')
      .eq('id', modifyTarget.id)
      .single();
    expect(Number(modifiedItem!.committed_quantity)).toBe(110);
    expect(Number(modifiedItem!.committed_value)).toBe(1100);

    // add applied -- only now does the agreement_item exist
    const { data: addedItems } = await supabase
      .from('agreement_items')
      .select('id, committed_quantity, committed_value, added_via_amendment_id')
      .eq('added_via_amendment_id', amendment.id);
    expect(addedItems).toHaveLength(1);
    expect(Number(addedItems![0].committed_quantity)).toBe(25);
    expect(Number(addedItems![0].committed_value)).toBe(250);
    cleanup.agreementItems.push(addedItems![0].id);

    // discontinue applied
    const { data: discontinuedItem } = await supabase
      .from('agreement_items')
      .select('discontinued_via_amendment_id, discontinued_at')
      .eq('id', discontinueTarget.id)
      .single();
    expect(discontinuedItem!.discontinued_via_amendment_id).toBe(amendment.id);
    expect(discontinuedItem!.discontinued_at).not.toBeNull();

    // approval_history recorded exactly once for 'approved' (not double-recorded
    // by both the Service and the RPC), plus once for 'submitted'.
    const history = await service.history(amendment.id, TEST_TENANT_ID);
    const actions = (history as any[]).map((h) => h.action);
    expect(actions).toEqual(['submitted', 'approved']);
  }, 30000);

  it('rejects approving a draft amendment', async () => {
    const agreement = await makeAgreement('approved');
    const item = await makeAgreementItem(agreement.id);
    const amendment = await service.create(
      TEST_TENANT_ID,
      {
        agreement_id: agreement.id,
        amendment_number: `REG-AMD-${Date.now()}`,
        amendment_type: 'general',
        items: [
          {
            action: 'modify',
            agreement_item_id: item.id,
            delta_committed_quantity: 1,
          },
        ],
      } as any,
      userAId,
    );
    cleanup.amendments.push(amendment.id);
    await expect(
      service.approve(amendment.id, TEST_TENANT_ID, userBId),
    ).rejects.toThrow('Cannot approve amendment with status: draft');
  });

  it('rejects a modify delta against an item with no existing committed_quantity (open-ended)', async () => {
    const agreement = await makeAgreement('approved');
    const openItem = await makeAgreementItem(agreement.id, itemId, null, null);
    const amendment = await service.create(
      TEST_TENANT_ID,
      {
        agreement_id: agreement.id,
        amendment_number: `REG-AMD-${Date.now()}`,
        amendment_type: 'quantity_change',
        items: [
          {
            action: 'modify',
            agreement_item_id: openItem.id,
            delta_committed_quantity: 5,
          },
        ],
      } as any,
      userAId,
    );
    cleanup.amendments.push(amendment.id);
    await service.submit(amendment.id, TEST_TENANT_ID, userAId);
    let thrown: Error | undefined;
    try {
      await service.approve(amendment.id, TEST_TENANT_ID, userBId);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown?.message).toContain('no existing committed_quantity');
  }, 20000);

  it('cannot cancel an approved amendment (terminal state)', async () => {
    const agreement = await makeAgreement('approved');
    const item = await makeAgreementItem(agreement.id);
    const amendment = await service.create(
      TEST_TENANT_ID,
      {
        agreement_id: agreement.id,
        amendment_number: `REG-AMD-${Date.now()}`,
        amendment_type: 'general',
        items: [
          {
            action: 'modify',
            agreement_item_id: item.id,
            delta_committed_quantity: 1,
          },
        ],
      } as any,
      userAId,
    );
    cleanup.amendments.push(amendment.id);
    await service.submit(amendment.id, TEST_TENANT_ID, userAId);
    await service.approve(amendment.id, TEST_TENANT_ID, userBId);
    await expect(
      service.cancel(amendment.id, TEST_TENANT_ID, userAId),
    ).rejects.toThrow('Cannot cancel an approved amendment');
  }, 20000);

  it('enforces tenant isolation: an amendment from another tenant is not visible', async () => {
    const agreement = await makeAgreement('approved');
    const item = await makeAgreementItem(agreement.id);
    const amendment = await service.create(
      TEST_TENANT_ID,
      {
        agreement_id: agreement.id,
        amendment_number: `REG-AMD-${Date.now()}`,
        amendment_type: 'general',
        items: [
          {
            action: 'modify',
            agreement_item_id: item.id,
            delta_committed_quantity: 1,
          },
        ],
      } as any,
      userAId,
    );
    cleanup.amendments.push(amendment.id);
    const otherTenantId = '00000000-0000-0000-0000-00000000dead';
    await expect(service.findById(amendment.id, otherTenantId)).rejects.toThrow(
      'Amendment not found',
    );
  });
});
