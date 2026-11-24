export interface PushTicket { hash: string; id: string; sentAt: number; state: 'queued' | 'provider_confirmed' | 'failed' | 'expired'; error?: string }
export function validateTickets(value: unknown): PushTicket[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is PushTicket => row && typeof row === 'object' &&
    typeof row.hash === 'string' && typeof row.id === 'string' && Number.isFinite(row.sentAt) &&
    ['queued', 'provider_confirmed', 'failed', 'expired'].includes(row.state));
}
export function applyReceipts(tickets: PushTicket[], receipts: Record<string, { status?: string; details?: { error?: string } }>,
  now: number, maxAgeMs: number): PushTicket[] {
  return tickets.map((ticket) => {
    if (ticket.state !== 'queued') return ticket;
    const receipt = receipts[ticket.id];
    if (receipt?.status === 'ok') return { ...ticket, state: 'provider_confirmed' };
    if (receipt?.status === 'error') return { ...ticket, state: 'failed', error: receipt.details?.error ?? 'UnknownProviderError' };
    if (now - ticket.sentAt >= maxAgeMs) return { ...ticket, state: 'expired', error: 'ReceiptUnavailable' };
    return ticket;
  });
}
/** Tickets prevent resending; provider confirmation is separate from app acknowledgement. */
export function deliverySummary(hashes: string[], accepted: string[], tickets: PushTicket[], receivedCount = 0) {
  const relevant = tickets.filter((ticket) => hashes.includes(ticket.hash));
  const remoteAccepted = hashes.length > 0 && hashes.every((hash) => accepted.includes(hash));
  const providerConfirmed = hashes.length > 0 && hashes.every((hash) => relevant.some((row) => row.hash === hash && row.state === 'provider_confirmed'));
  const queued = relevant.some((row) => row.state === 'queued');
  const failed = relevant.some((row) => row.state === 'failed' || row.state === 'expired');
  return { remoteAccepted, providerConfirmed, receivedCount,
    deliveryComplete: providerConfirmed || (remoteAccepted && !queued && (failed || relevant.length === 0)),
    state: !hashes.length ? 'no_recipients' : providerConfirmed ? 'provider_confirmed' : failed ? 'receipt_failed' : remoteAccepted ? 'receipt_pending' : 'push_pending' };
}
