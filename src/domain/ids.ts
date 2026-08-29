import { uuidv7 } from 'uuidv7';

/**
 * A new client-generated UUIDv7. Version 7 embeds a millisecond timestamp in the
 * high bits, so ids sort by creation order — which is why a dive created offline
 * never needs re-mapping when it eventually syncs.
 */
export function newId(): string {
  return uuidv7();
}
