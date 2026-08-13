import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

// System Chart of Accounts template — exactly the 8 account_roles M183
// defines (sales_revenue, inventory_asset, cogs, accounts_receivable,
// accounts_payable, tax_payable, default_cash, default_bank). Codes follow
// a conventional 1xxx asset / 2xxx liability / 4xxx revenue / 5xxx expense
// numbering; tenants may extend the tree later (M181 supports full
// hierarchy) but every M184 posting role is guaranteed to resolve from day
// one, which is the only thing M182/M184 actually require.
const SYSTEM_ACCOUNT_TEMPLATE: Array<{
  role_code: string;
  code: string;
  name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  normal_balance: 'debit' | 'credit';
}> = [
  {
    role_code: 'default_cash',
    code: '1000',
    name: 'Cash',
    account_type: 'asset',
    normal_balance: 'debit',
  },
  {
    role_code: 'default_bank',
    code: '1010',
    name: 'Bank',
    account_type: 'asset',
    normal_balance: 'debit',
  },
  {
    role_code: 'accounts_receivable',
    code: '1100',
    name: 'Accounts Receivable',
    account_type: 'asset',
    normal_balance: 'debit',
  },
  {
    role_code: 'inventory_asset',
    code: '1200',
    name: 'Inventory Asset',
    account_type: 'asset',
    normal_balance: 'debit',
  },
  {
    role_code: 'accounts_payable',
    code: '2100',
    name: 'Accounts Payable',
    account_type: 'liability',
    normal_balance: 'credit',
  },
  {
    role_code: 'tax_payable',
    code: '2200',
    name: 'Tax Payable',
    account_type: 'liability',
    normal_balance: 'credit',
  },
  {
    role_code: 'sales_revenue',
    code: '4000',
    name: 'Sales Revenue',
    account_type: 'revenue',
    normal_balance: 'credit',
  },
  {
    role_code: 'cogs',
    code: '5000',
    name: 'Cost of Goods Sold',
    account_type: 'expense',
    normal_balance: 'debit',
  },
];

@Injectable()
export class AccountingBootstrapService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  // Sole sanctioned entry point for initializing a tenant's accounting
  // configuration. Called once, synchronously, inside AuthService.register()
  // right after the branch is created — any failure here throws and the
  // caller's existing compensating delete on `tenants` unwinds everything
  // this method inserted (accounting_owners/accounts/etc. all cascade off
  // tenant_id ON DELETE CASCADE). Does not modify M182/M184.
  async bootstrap(
    tenantId: string,
    branchId: string,
    branchName: string,
  ): Promise<void> {
    const { data: owner, error: ownerError } = await this.supabase
      .from('accounting_owners')
      .insert({
        tenant_id: tenantId,
        branch_id: branchId,
        owner_type_code: 'branch',
        name: branchName,
        status: 'active',
      })
      .select('id')
      .single();

    if (ownerError || !owner) {
      throw new ServiceUnavailableException(
        'Failed to create accounting owner',
      );
    }

    const { error: assignmentError } = await this.supabase
      .from('branch_accounting_assignments')
      .insert({
        tenant_id: tenantId,
        branch_id: branchId,
        accounting_owner_id: owner.id,
        effective_from: new Date().toISOString().slice(0, 10),
        reason: 'Automatic bootstrap on tenant registration',
      });

    if (assignmentError) {
      throw new ServiceUnavailableException(
        'Failed to create branch accounting assignment',
      );
    }

    // M180's trg_accounting_owners_create_default_book already created the
    // default Primary accounting_book for `owner` — fetch it rather than
    // inserting a second one (uq_accounting_books_owner_default would reject
    // a duplicate anyway).
    const { data: book, error: bookError } = await this.supabase
      .from('accounting_books')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('accounting_owner_id', owner.id)
      .eq('is_default', true)
      .maybeSingle();

    if (bookError || !book) {
      throw new ServiceUnavailableException(
        'Default accounting book was not created',
      );
    }

    const today = new Date();
    const { data: calendar, error: calendarError } = await this.supabase
      .from('fiscal_calendars')
      .insert({
        tenant_id: tenantId,
        start_month: 1,
        start_day: 1,
        effective_from: `${today.getUTCFullYear()}-01-01`,
      })
      .select('id')
      .single();

    if (calendarError || !calendar) {
      throw new ServiceUnavailableException('Failed to create fiscal calendar');
    }

    const yearLabel = String(today.getUTCFullYear());
    const { error: fiscalYearError } = await this.supabase.rpc(
      'fn_generate_fiscal_year',
      {
        p_tenant_id: tenantId,
        p_fiscal_calendar_id: calendar.id,
        p_calendar_year: today.getUTCFullYear(),
        p_year_label: yearLabel,
      },
    );

    if (fiscalYearError) {
      throw new ServiceUnavailableException('Failed to generate fiscal year');
    }

    const { data: accounts, error: accountsError } = await this.supabase
      .from('accounts')
      .insert(
        SYSTEM_ACCOUNT_TEMPLATE.map((a) => ({
          tenant_id: tenantId,
          code: a.code,
          name: a.name,
          account_type: a.account_type,
          normal_balance: a.normal_balance,
          is_posting_account: true,
          is_system_account: true,
          is_active: true,
        })),
      )
      .select('id, code');

    if (
      accountsError ||
      !accounts ||
      accounts.length !== SYSTEM_ACCOUNT_TEMPLATE.length
    ) {
      throw new ServiceUnavailableException(
        'Failed to create system chart of accounts',
      );
    }

    const accountIdByCode = new Map(accounts.map((a) => [a.code, a.id]));

    const { error: roleAssignmentError } = await this.supabase
      .from('account_role_assignments')
      .insert(
        SYSTEM_ACCOUNT_TEMPLATE.map((a) => ({
          tenant_id: tenantId,
          role_code: a.role_code,
          account_id: accountIdByCode.get(a.code),
        })),
      );

    if (roleAssignmentError) {
      throw new ServiceUnavailableException('Failed to assign account roles');
    }
  }
}
