export interface CreateCustomerInput {
  tenantId: string;
  email: string;
  name: string;
}

export interface CreateCustomerResult {
  providerCustomerId: string;
}

export interface CreatePaymentInput {
  tenantId: string;
  providerCustomerId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  description: string;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
  status: 'pending' | 'succeeded' | 'failed';
  failureReason?: string;
}

export interface RefundPaymentInput {
  providerPaymentId: string;
  amount: number;
}

export interface RefundPaymentResult {
  success: boolean;
}

export interface PaymentProvider {
  readonly providerName: string;

  createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult>;

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult>;
}