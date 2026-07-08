import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GiftCardsRepository } from './gift-cards.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateGiftCardDto } from './dto/create-gift-card.dto';
import { UpdateGiftCardDto } from './dto/update-gift-card.dto';

export interface GiftCard {
  id: string;
  code: string;
  initial_balance: number;
  current_balance: number;
  customer_id: string | null;
  is_active: boolean;
  expires_at: string | null;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — avoids ambiguous handwritten/read-aloud codes

function generateCode(): string {
  let code = 'GC-';
  for (let i = 0; i < 8; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

@Injectable()
export class GiftCardsService {
  private readonly logger = new Logger(GiftCardsService.name);

  constructor(private readonly repo: GiftCardsRepository) {}

  findAll(tenant: TenantContext) {
    return this.repo.findAll(tenant);
  }

  async create(tenant: TenantContext, dto: CreateGiftCardDto) {
    if (dto.code) {
      const existing = await this.repo.findByCode(tenant, dto.code);
      if (existing) throw new BadRequestException('A gift card with this code already exists');
      return this.repo.create(tenant, { ...dto, code: dto.code.toUpperCase() });
    }

    // Auto-generate, retrying on the extremely rare collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      const existing = await this.repo.findByCode(tenant, code);
      if (!existing) return this.repo.create(tenant, { ...dto, code });
    }
    throw new BadRequestException('Could not generate a unique gift card code, try again');
  }

  async update(tenant: TenantContext, id: string, dto: UpdateGiftCardDto) {
    const existing = await this.repo.findById(tenant, id);
    if (!existing) throw new NotFoundException('Gift card not found');
    return this.repo.update(tenant, id, dto);
  }

  async remove(tenant: TenantContext, id: string) {
    const existing = await this.repo.findById(tenant, id);
    if (!existing) throw new NotFoundException('Gift card not found');
    await this.repo.softDelete(tenant, id);
    return { message: 'Gift card deleted' };
  }

  /** Validates a gift card code and the requested redemption amount against it. Throws on any failure — a rejected gift card must block checkout, not silently apply nothing. */
  async validate(tenant: TenantContext, code: string, amount: number): Promise<GiftCard> {
    const card = await this.repo.findByCode(tenant, code);
    if (!card) throw new BadRequestException('Invalid gift card code');
    if (!card.is_active) throw new BadRequestException('This gift card is no longer active');
    if (card.expires_at && new Date(card.expires_at) < new Date()) {
      throw new BadRequestException('This gift card has expired');
    }
    if (card.current_balance < amount) {
      throw new BadRequestException(
        `This gift card only has ${card.current_balance} remaining`,
      );
    }
    return card as GiftCard;
  }

  /**
   * Best-effort redemption, called after the order already exists — same tradeoff as
   * CouponsService.redeem (STATUS.md §73): throwing here would leave an already-committed
   * order behind while the API call itself errors out to the client. The race window this
   * protects against (the same code redeemed twice concurrently) requires the same physical
   * gift card being used by two cashiers at the same instant, which is rare in practice.
   */
  async redeem(giftCardId: string, amount: number, orderId: string): Promise<void> {
    try {
      const result = await this.repo.redeem(giftCardId, amount);
      if (result === null) {
        this.logger.warn(`Gift card ${giftCardId} redemption lost a race or was deactivated (order ${orderId})`);
      }
    } catch (err) {
      this.logger.warn(`Gift card redemption failed for order ${orderId}: ${(err as Error)?.message ?? err}`);
    }
  }
}
