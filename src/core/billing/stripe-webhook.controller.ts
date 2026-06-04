import {
  Controller,
  Post,
  Headers,
  RawBodyRequest,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import Stripe from 'stripe';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

type StripeInstance = InstanceType<typeof Stripe>;

@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);
  private readonly stripe: StripeInstance | null = null;
  private readonly webhookSecret: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');

    if (secretKey && webhookSecret) {
      this.webhookSecret = webhookSecret;
      this.stripe = new Stripe(secretKey, {
        apiVersion: '2026-05-27.dahlia',
      });
    } else {
      this.logger.warn('[Stripe Webhook] Stripe not configured — webhook endpoint disabled');
    }
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ received: boolean }> {
    if (!this.stripe || !this.webhookSecret) {
      throw new BadRequestException('Stripe is not configured');
    }

    if (!req.rawBody) {
      throw new BadRequestException('Missing raw body');
    }

    let event: ReturnType<StripeInstance['webhooks']['constructEvent']>;
    try {
      event = this.stripe.webhooks.constructEvent(req.rawBody, signature, this.webhookSecret);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Webhook signature verification failed';
      this.logger.error(`[Stripe Webhook] Signature error: ${message}`);
      throw new BadRequestException(`Webhook Error: ${message}`);
    }

    this.logger.log(`[Stripe Webhook] Event: ${event.type} — id: ${event.id}`);

    switch (event.type) {
      case 'payment_intent.payment_failed':
        await this.handlePaymentFailed(event.data.object as unknown as Record<string, unknown>);
        break;
      case 'payment_intent.succeeded':
        await this.handlePaymentSucceeded(event.data.object as unknown as Record<string, unknown>);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as unknown as Record<string, unknown>);
        break;
      default:
        this.logger.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    return { received: true };
  }

  private async handlePaymentFailed(obj: Record<string, unknown>): Promise<void> {
    const invoiceId = (obj.metadata as Record<string, string> | undefined)?.invoiceId;
    const providerPaymentId = obj.id as string | undefined;
    const lastError = obj.last_payment_error as Record<string, string> | undefined;

    if (!invoiceId) {
      this.logger.warn(`[Stripe Webhook] payment_intent.payment_failed — no invoiceId in metadata`);
      return;
    }

    await this.supabase
      .from('payments')
      .update({
        status: 'failed',
        failure_reason: lastError?.message ?? 'Unknown failure',
        updated_at: new Date().toISOString(),
      })
      .eq('provider_payment_id', providerPaymentId);

    await this.supabase
      .from('billing_invoices')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', invoiceId);

    this.logger.log(`[Stripe Webhook] Marked invoice ${invoiceId} as failed`);
  }

  private async handlePaymentSucceeded(obj: Record<string, unknown>): Promise<void> {
    const invoiceId = (obj.metadata as Record<string, string> | undefined)?.invoiceId;
    const providerPaymentId = obj.id as string | undefined;

    if (!invoiceId) {
      this.logger.warn(`[Stripe Webhook] payment_intent.succeeded — no invoiceId in metadata`);
      return;
    }

    await this.supabase
      .from('payments')
      .update({ status: 'succeeded', updated_at: new Date().toISOString() })
      .eq('provider_payment_id', providerPaymentId);

    await this.supabase
      .from('billing_invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId);

    this.logger.log(`[Stripe Webhook] Marked invoice ${invoiceId} as paid`);
  }

  private async handleSubscriptionDeleted(obj: Record<string, unknown>): Promise<void> {
    const tenantId = (obj.metadata as Record<string, string> | undefined)?.tenantId;

    if (!tenantId) {
      this.logger.warn(`[Stripe Webhook] subscription.deleted — no tenantId in metadata`);
      return;
    }

    await this.supabase
      .from('subscriptions')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('status', 'active');

    this.logger.log(`[Stripe Webhook] Cancelled subscription for tenant: ${tenantId}`);
  }
}