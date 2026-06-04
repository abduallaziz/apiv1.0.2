import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

import {
  PaymentProvider,
  CreateCustomerInput,
  CreateCustomerResult,
  CreatePaymentInput,
  CreatePaymentResult,
  RefundPaymentInput,
  RefundPaymentResult,
} from './payment-provider.interface';

type StripeInstance = InstanceType<typeof Stripe>;

@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly providerName = 'stripe';
  private stripe: StripeInstance | null = null;
  private readonly logger = new Logger(StripePaymentProvider.name);

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (secretKey) {
      this.stripe = new Stripe(secretKey, {
        apiVersion: '2026-05-27.dahlia',
      });
    } else {
      this.logger.warn('[Stripe] STRIPE_SECRET_KEY not set — Stripe disabled');
    }
  }

  private getStripe(): StripeInstance {
    if (!this.stripe) {
      throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY.');
    }
    return this.stripe;
  }

  async createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult> {
    const customer = await this.getStripe().customers.create({
      email: input.email,
      name: input.name,
      metadata: { tenantId: input.tenantId },
    });
    this.logger.log(`[Stripe] Created customer: ${customer.id} for tenant: ${input.tenantId}`);
    return { providerCustomerId: customer.id };
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    try {
      const paymentIntent = await this.getStripe().paymentIntents.create({
        amount: Math.round(input.amount * 100),
        currency: input.currency.toLowerCase(),
        customer: input.providerCustomerId,
        description: input.description,
        metadata: { tenantId: input.tenantId, invoiceId: input.invoiceId },
        confirm: true,
        payment_method_types: ['card'],
        off_session: true,
      });

      const status =
        paymentIntent.status === 'succeeded'
          ? 'succeeded'
          : paymentIntent.status === 'requires_payment_method'
            ? 'failed'
            : 'pending';

      this.logger.log(`[Stripe] PaymentIntent ${paymentIntent.id} — status: ${status}`);
      return { providerPaymentId: paymentIntent.id, status };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown stripe error';
      this.logger.error(`[Stripe] createPayment failed: ${message}`);
      return { providerPaymentId: '', status: 'failed', failureReason: message };
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    try {
      await this.getStripe().refunds.create({
        payment_intent: input.providerPaymentId,
        amount: Math.round(input.amount * 100),
      });
      this.logger.log(`[Stripe] Refund created for payment: ${input.providerPaymentId}`);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown stripe error';
      this.logger.error(`[Stripe] refundPayment failed: ${message}`);
      return { success: false };
    }
  }
}