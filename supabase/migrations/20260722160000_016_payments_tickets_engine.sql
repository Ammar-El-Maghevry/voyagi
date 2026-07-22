-- Phase 12 (Payments) + Phase 13 (Tickets) engine.
--
-- The payments and tickets tables, their RLS read policies, append-only /
-- no-delete guards, updated_at triggers and the amount/currency snapshot check
-- (public.validate_payment_booking) already exist from migrations 008, 011 and
-- 012. This migration adds only the missing *lifecycle* invariants as database
-- triggers so the documented state machines cannot be bypassed even by a caller
-- that reaches the row outside the application (defense in depth; the backend
-- role bypasses RLS). No new tables are introduced: payment lifecycle audit is
-- recorded as public.booking_events (PAYMENT_PENDING / PAYMENT_CONFIRMED /
-- REFUND_CREATED / REFUND_COMPLETED) and refunds are payment status transitions
-- on the same row, per architecture/09-payment-state-machine.md and
-- architecture/04-database-erd.md.

-- ---------------------------------------------------------------------------
-- Payment lifecycle: identity/amount immutability, write-once provider
-- reference, and the documented status transition matrix.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_payment_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A payment attempt is an immutable financial record: its booking, method,
  -- internal reference, amount, currency and creation time never change. A
  -- retry is always a NEW payment row with a new internal_reference (the
  -- Booking 1:N Payments rule), never an in-place edit of a failed attempt.
  if new.booking_id is distinct from old.booking_id
    or new.method is distinct from old.method
    or new.internal_reference is distinct from old.internal_reference
    or new.amount is distinct from old.amount
    or new.currency is distinct from old.currency
    or new.created_at is distinct from old.created_at
  then
    raise exception using
      errcode = '55000',
      message = 'payment identity and amount are immutable';
  end if;

  -- The provider reference is write-once: once a provider settlement id has been
  -- stored it must never be cleared or overwritten (it is the matching key for
  -- the uq_payment_provider_ref webhook-idempotency index).
  if old.provider_reference is not null
     and new.provider_reference is distinct from old.provider_reference then
    raise exception using
      errcode = '55000',
      message = 'provider_reference is write-once and cannot change';
  end if;

  if new.status = old.status then
    return new;
  end if;

  -- Phase 12 transition matrix (architecture/09-payment-state-machine.md), with
  -- FULL-refund-only scope:
  --   PENDING    -> PROCESSING | SUCCEEDED | CANCELLED
  --   PROCESSING -> SUCCEEDED  | FAILED    | CANCELLED
  --   SUCCEEDED  -> REFUNDED   (full refund)
  -- FAILED, CANCELLED and REFUNDED are terminal. PARTIALLY_REFUNDED remains a
  -- valid enum value for future compatibility but is intentionally unreachable:
  -- partial refunds are deferred until a refunded-amount model exists, so no
  -- transition to PARTIALLY_REFUNDED is authorized here.
  if not (
    (old.status = 'PENDING' and new.status in ('PROCESSING', 'SUCCEEDED', 'CANCELLED'))
    or (old.status = 'PROCESSING' and new.status in ('SUCCEEDED', 'FAILED', 'CANCELLED'))
    or (old.status = 'SUCCEEDED' and new.status = 'REFUNDED')
  ) then
    raise exception using
      errcode = '23514',
      message = format('illegal payment transition %s -> %s', old.status, new.status);
  end if;

  return new;
end;
$$;

create trigger enforce_payment_transition
  before update on public.payments
  for each row execute function public.enforce_payment_transition();

-- ---------------------------------------------------------------------------
-- Ticket lifecycle: immutable issuance snapshot (including the QR hash) and a
-- timestamp-based state machine. There is no ticket_status enum; a ticket is
-- ISSUED (issued_at) and then moves to at most one terminal timestamp —
-- checked_in_at (validated at boarding) or cancelled_at (revoked). Both are
-- write-once and mutually exclusive.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_ticket_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.booking_id is distinct from old.booking_id
    or new.passenger_id is distinct from old.passenger_id
    or new.seat_reservation_id is distinct from old.seat_reservation_id
    or new.ticket_number is distinct from old.ticket_number
    or new.qr_token_hash is distinct from old.qr_token_hash
    or new.issued_at is distinct from old.issued_at
  then
    raise exception using
      errcode = '55000',
      message = 'ticket issuance snapshot is immutable';
  end if;

  -- A revoked ticket is terminal.
  if old.cancelled_at is not null
     and (new.cancelled_at is distinct from old.cancelled_at
          or new.checked_in_at is distinct from old.checked_in_at) then
    raise exception using
      errcode = '55000',
      message = 'a cancelled ticket is terminal';
  end if;

  -- Check-in is write-once (duplicate scans are a no-op, never a re-write).
  if old.checked_in_at is not null
     and new.checked_in_at is distinct from old.checked_in_at then
    raise exception using
      errcode = '55000',
      message = 'ticket check-in is write-once';
  end if;

  -- The two terminal timestamps are mutually exclusive.
  if new.checked_in_at is not null and new.cancelled_at is not null then
    raise exception using
      errcode = '23514',
      message = 'a ticket cannot be both checked-in and cancelled';
  end if;

  return new;
end;
$$;

create trigger enforce_ticket_lifecycle
  before update on public.tickets
  for each row execute function public.enforce_ticket_lifecycle();

-- Supports "list tickets for a booking" and issuance-eligibility lookups.
create index idx_tickets_booking on public.tickets (booking_id, issued_at desc);

-- ---------------------------------------------------------------------------
-- Durable idempotency for payment initiation. Payments reuse the existing
-- public.idempotency_records table (migration 015) but under a DISTINCT
-- operation scope ('CREATE_PAYMENT'), so a payment key never collides with a
-- booking key. A payment operation points at the created payment via a new
-- payment_id column; the completion invariant is relaxed to require at least one
-- resource pointer (booking_id for booking ops, payment_id for payment ops).
-- ---------------------------------------------------------------------------
alter table public.idempotency_records
  add column payment_id uuid references public.payments (id) on delete restrict;

alter table public.idempotency_records
  drop constraint ck_idempotency_completion,
  add constraint ck_idempotency_completion check (
    (response_status is null and completed_at is null
      and booking_id is null and payment_id is null)
    or (response_status is not null and completed_at is not null
      and (booking_id is not null or payment_id is not null))
  );

create index idx_idempotency_payment
  on public.idempotency_records (payment_id) where payment_id is not null;
