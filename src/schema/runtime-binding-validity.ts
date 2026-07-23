import { z } from "zod";

/**
 * Absolute hard ceiling for runtime-binding leases. This is a structural
 * safety limit, not a default or recommended lease duration. Control-plane
 * policy may impose a substantially lower maximum.
 */
export const MAX_RUNTIME_BINDING_TTL_SECONDS = 315_360_000;

/**
 * Runtime-binding TTLs are positive whole seconds. The explicit upper bound
 * keeps epoch-millisecond arithmetic within the safe integer range even when
 * combined with the latest four-digit RFC 3339 timestamp.
 */
export const RuntimeBindingTtlSecondsSchema = z
  .number()
  .int()
  .positive()
  .max(MAX_RUNTIME_BINDING_TTL_SECONDS);
export type RuntimeBindingTtlSeconds = z.infer<typeof RuntimeBindingTtlSecondsSchema>;

/**
 * An unambiguous RFC 3339 instant at millisecond precision or coarser.
 * `offset: true` accepts both `Z` and explicit numeric offsets while continuing
 * to reject bare local timestamps.
 */
export const Rfc3339WithOffsetSchema = z.union([
  z.string().datetime({ offset: true, precision: 0 }),
  z.string().datetime({ offset: true, precision: 1 }),
  z.string().datetime({ offset: true, precision: 2 }),
  z.string().datetime({ offset: true, precision: 3 }),
]);
export type Rfc3339WithOffset = z.infer<typeof Rfc3339WithOffsetSchema>;
