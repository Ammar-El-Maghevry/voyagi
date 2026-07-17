create type public.user_role_enum as enum (
  'SUPER_ADMIN', 'COMPANY_MANAGER', 'BRANCH_EMPLOYEE', 'AGENT', 'PASSENGER'
);
create type public.bus_status_enum as enum (
  'ACTIVE', 'IN_MAINTENANCE', 'OUT_OF_SERVICE', 'ARCHIVED'
);
create type public.staff_type_enum as enum ('DRIVER', 'ASSISTANT');
create type public.trip_status_enum as enum (
  'SCHEDULED', 'BOARDING', 'ONGOING', 'COMPLETED', 'CANCELLED'
);
create type public.booking_channel_enum as enum (
  'MOBILE_APP', 'WEB', 'AGENT', 'BRANCH_OFFICE', 'ADMIN'
);
create type public.booking_status_enum as enum (
  'DRAFT', 'HELD', 'PENDING_PAYMENT', 'CONFIRMED',
  'PARTIALLY_CANCELLED', 'CANCELLED', 'COMPLETED', 'EXPIRED'
);
create type public.seat_reservation_status_enum as enum (
  'HELD', 'CONFIRMED', 'CHECKED_IN', 'RELEASED', 'CANCELLED'
);
create type public.payment_method_enum as enum (
  'CASH', 'BANKILY', 'MASRVI', 'SEDDAD', 'OTHER'
);
create type public.payment_status_enum as enum (
  'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED',
  'PARTIALLY_REFUNDED', 'REFUNDED'
);
create type public.commission_status_enum as enum ('PENDING', 'EARNED', 'PAID', 'CANCELLED');
create type public.maintenance_type_enum as enum (
  'OIL_CHANGE', 'GENERAL_SERVICE', 'BRAKE_SERVICE', 'ENGINE', 'INSPECTION', 'OTHER'
);
create type public.maintenance_status_enum as enum (
  'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
);
create type public.trip_event_type_enum as enum (
  'TRIP_CREATED', 'BOARDING_OPENED', 'BOARDING_CLOSED', 'DEPARTED',
  'DELAYED', 'ARRIVED', 'CANCELLED', 'BUS_CHANGED', 'DRIVER_CHANGED'
);
create type public.trip_event_source_enum as enum ('SYSTEM', 'ADMIN', 'AGENT', 'EMPLOYEE', 'API');
