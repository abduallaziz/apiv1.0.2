import { Injectable, BadRequestException } from '@nestjs/common';

export interface PaymentResult {
  success: boolean;
  change?: number;
  method: string;
}

@Injectable()
export class PaymentEngine {
  processCashPayment(amount: number, tendered: number): PaymentResult {
    if (tendered < amount) {
      throw new BadRequestException('Insufficient cash tendered');
    }
    return {
      success: true,
      change: parseFloat((tendered - amount).toFixed(2)),
      method: 'cash',
    };
  }

  processCardPayment(amount: number): PaymentResult {
    if (amount <= 0) {
      throw new BadRequestException('Invalid payment amount');
    }
    return { success: true, method: 'card' };
  }

  processSplitPayment(
    total: number,
    cashAmount: number,
    cardAmount: number,
  ): PaymentResult {
    const sum = parseFloat((cashAmount + cardAmount).toFixed(2));
    if (sum < total) {
      throw new BadRequestException('Split payment does not cover total');
    }
    return {
      success: true,
      change: parseFloat((sum - total).toFixed(2)),
      method: 'split',
    };
  }

  validatePaymentMethod(method: string, allowed: string[]): boolean {
    return allowed.includes(method);
  }
}