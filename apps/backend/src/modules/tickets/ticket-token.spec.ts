import { deriveTicketStatus, TicketStatus } from './ticket.types';
import { TicketTokenService } from './ticket-token';

describe('TicketTokenService', () => {
  const service = new TicketTokenService();

  it('generates a high-entropy raw token and a stable hash', () => {
    const token = service.generateToken();
    expect(token.raw).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(token.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(service.hash(token.raw)).toBe(token.hash);
  });

  it('never returns the same raw token twice', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => service.generateToken().raw));
    expect(tokens.size).toBe(500);
  });

  it('does not derive the token from any identifier (hash is one-way)', () => {
    const token = service.generateToken();
    // The stored hash must not reveal the raw token.
    expect(token.hash).not.toContain(token.raw);
    expect(token.raw).not.toContain(token.hash);
  });

  it('produces dated ticket numbers', () => {
    expect(service.generateTicketNumber(new Date('2026-07-22T00:00:00Z'))).toMatch(
      /^TKT-20260722-[0-9A-Z]{6}$/,
    );
  });
});

describe('deriveTicketStatus', () => {
  it('maps timestamps to the derived lifecycle', () => {
    expect(deriveTicketStatus({})).toBe(TicketStatus.Issued);
    expect(deriveTicketStatus({ checkedInAt: new Date() })).toBe(TicketStatus.CheckedIn);
    expect(deriveTicketStatus({ cancelledAt: new Date() })).toBe(TicketStatus.Cancelled);
    // Cancellation dominates when both are somehow set.
    expect(deriveTicketStatus({ checkedInAt: new Date(), cancelledAt: new Date() })).toBe(
      TicketStatus.Cancelled,
    );
  });
});
