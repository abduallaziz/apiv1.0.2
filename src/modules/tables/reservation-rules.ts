import { BadRequestException, ConflictException } from '@nestjs/common';

/** Two bookings of the same table closer than this are a double booking. */
export const RESERVATION_WINDOW_MINUTES = 120;
/** Clock-skew grace when rejecting reservations in the past. */
export const PAST_GRACE_MINUTES = 5;

export type ReservationStatus =
  | 'confirmed'
  | 'seated'
  | 'cancelled'
  | 'no_show';

const TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  confirmed: ['seated', 'cancelled', 'no_show'],
  seated: [],
  cancelled: ['confirmed'],
  no_show: ['confirmed'],
};

export function canChangeStatus(
  from: ReservationStatus,
  to: ReservationStatus,
): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function assertNotInPast(iso: string, now = Date.now()): void {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) {
    throw new BadRequestException('reservation_time must be a valid date');
  }
  if (t < now - PAST_GRACE_MINUTES * 60_000) {
    throw new BadRequestException('Reservation time cannot be in the past');
  }
}

export function assertPartyFits(
  party: number | null | undefined,
  capacity: number | null | undefined,
): void {
  if (party && capacity && party > capacity) {
    throw new BadRequestException(
      `Party size exceeds the table capacity (${capacity})`,
    );
  }
}

/** [from, to] ISO bounds of the window that conflicts with a booking at `iso`. */
export function conflictWindow(iso: string): { from: string; to: string } {
  const t = new Date(iso).getTime();
  const span = RESERVATION_WINDOW_MINUTES * 60_000;
  return {
    from: new Date(t - span + 1).toISOString(),
    to: new Date(t + span - 1).toISOString(),
  };
}

export function assertNoConflict(conflicts: number): void {
  if (conflicts > 0) {
    throw new ConflictException(
      'This table is already reserved around that time',
    );
  }
}
