import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/**
 * RPC functions raise plain Postgres exceptions with conventional message
 * prefixes (INSUFFICIENT_STOCK, INSUFFICIENT_COST_LAYERS, "not found", "is not
 * in draft status" etc). Supabase surfaces these as PostgrestError.message.
 * Map them to the right HTTP exception instead of letting them fall through
 * to the global filter as 500s.
 */
export function throwFromRpcError(error: { message: string; code?: string }): never {
  const message = error.message ?? 'Unknown database error';

  if (message.includes('INSUFFICIENT_STOCK') || message.includes('INSUFFICIENT_COST_LAYERS')) {
    throw new ConflictException(message);
  }
  if (message.includes('not found')) {
    throw new NotFoundException(message);
  }
  if (
    message.includes('is not in draft status') ||
    message.includes('is not in_transit') ||
    message.includes('is not active') ||
    message.includes('cannot be posted') ||
    message.includes('requires approval') ||
    message.includes('invalid')
  ) {
    throw new BadRequestException(message);
  }

  throw new BadRequestException(message);
}
