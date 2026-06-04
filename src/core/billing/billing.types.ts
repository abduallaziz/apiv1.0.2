export enum SubscriptionStatus {
  TRIAL = 'trial',
  ACTIVE = 'active',
  GRACE_PERIOD = 'grace_period',
  SUSPENDED = 'suspended',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

export enum BillingCycle {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

export enum PaymentProviderName {
  MOCK = 'mock',
  STRIPE = 'stripe',
  MOYASAR = 'moyasar',
  TAP = 'tap',
}

export interface PlanLimits {
  max_users: number;
  max_branches: number;
}

export interface SubscriptionRecord {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  billing_cycle: BillingCycle;
  started_at: string;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
  suspended_at: string | null;
  grace_period_ends_at: string | null;
}

export interface PlanRecord {
  id: string;
  name: string;
  description: string | null;
  price_monthly: number;
  price_yearly: number;
  max_users: number;
  max_branches: number;
  trial_days: number;
  is_active: boolean;
}

export interface BillingCustomerRecord {
  id: string;
  tenant_id: string;
  provider: PaymentProviderName;
  provider_customer_id: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface InvoiceSummary {
  id: string;
  invoice_number: string;
  total_amount: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'overdue';
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
}

export interface PaymentSummary {
  id: string;
  amount: number;
  currency: string;
  provider: PaymentProviderName;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  paid_at: string | null;
  failure_reason: string | null;
}