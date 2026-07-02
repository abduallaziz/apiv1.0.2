import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentProvider,
  CreateCustomerInput,
  CreateCustomerResult,
  CreatePaymentInput,
  CreatePaymentResult,
  RefundPaymentInput,
  RefundPaymentResult,
} from './payment-provider.interface';

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly providerName = 'mock';
  private readonly logger = new Logger(MockPaymentProvider.name);

  async createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult> {
    const providerCustomerId = `mock_cus_${input.tenantId.replace(/-/g, '').slice(0, 16)}`;
    this.logger.log(`[Mock] Created customer: ${providerCustomerId} for tenant: ${input.tenantId}`);
    return { providerCustomerId };
  }


  async charge(params: {
  customerId: string;
  amount: number;
  currency: string;
  description: string;
}): Promise<{ success: boolean; error?: string }> {
  // Mock: دائماً يفشل في الـ dunning للاختبار
  return { success: false, error: 'Mock: insufficient funds' };
}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const providerPaymentId = `mock_pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.logger.log(
      `[Mock] Payment ${providerPaymentId} — amount: ${input.amount} ${input.currency} — invoice: ${input.invoiceId}`,
    );
    return {
      providerPaymentId,
      status: 'succeeded',
    };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    this.logger.log(`[Mock] Refund for payment: ${input.providerPaymentId} — amount: ${input.amount}`);
    return { success: true };
  }
}