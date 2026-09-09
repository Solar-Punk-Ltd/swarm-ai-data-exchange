import type { Response } from 'express';
import type { ApiError } from '@solarpunk/swarm-catalog';

// Error code catalog (§15.2). Each code maps to a fixed HTTP status and retryable flag.
export type ErrorCode =
  | 'item_not_found'
  | 'item_retired'
  | 'item_not_purchasable'
  | 'intent_malformed'
  | 'intent_signature_invalid'
  | 'intent_domain_mismatch'
  | 'intent_item_mismatch'
  | 'intent_payment_mismatch'
  | 'intent_expired'
  | 'intent_not_yet_valid'
  | 'intent_replay'
  | 'payment_destination_untaxed'
  | 'payment_verify_failed'
  | 'payment_settle_failed'
  | 'act_grant_failed'
  | 'state_feed_failed'
  | 'internal_error';

interface CodeSpec {
  status: number;
  retryable: boolean;
}

const CODES: Record<ErrorCode, CodeSpec> = {
  item_not_found: { status: 404, retryable: false },
  item_retired: { status: 410, retryable: false },
  item_not_purchasable: { status: 404, retryable: false },
  intent_malformed: { status: 400, retryable: false },
  intent_signature_invalid: { status: 400, retryable: false },
  intent_domain_mismatch: { status: 400, retryable: false },
  intent_item_mismatch: { status: 400, retryable: false },
  intent_payment_mismatch: { status: 400, retryable: false },
  intent_expired: { status: 400, retryable: false },
  intent_not_yet_valid: { status: 400, retryable: true },
  intent_replay: { status: 409, retryable: false },
  // Not in the §15.2 catalog — marketplace-level guard. The catalog entry advertises a payTo
  // that is not the configured split contract, so the sale would bypass the sales tax and
  // produce no valid Proof-of-Purchase. Not retryable: the publisher must republish the item.
  payment_destination_untaxed: { status: 400, retryable: false },
  payment_verify_failed: { status: 402, retryable: false },
  payment_settle_failed: { status: 502, retryable: true },
  act_grant_failed: { status: 500, retryable: true },
  state_feed_failed: { status: 500, retryable: false },
  internal_error: { status: 500, retryable: true },
};

// Thrown anywhere in the request pipeline; carries everything needed to emit an ApiError envelope.
export class PurchaseError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PurchaseError';
    this.code = code;
    this.status = CODES[code].status;
    this.retryable = CODES[code].retryable;
    this.details = details;
  }

  toApiError(): ApiError {
    return {
      error: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
      retryable: this.retryable,
    };
  }
}

// Serialize any error to the ApiError envelope (§15.1) and send it.
export function sendError(res: Response, err: unknown): void {
  if (err instanceof PurchaseError) {
    res.status(err.status).json(err.toApiError());
    return;
  }
  const internal = new PurchaseError(
    'internal_error',
    err instanceof Error ? err.message : 'Unspecified server failure',
  );
  res.status(internal.status).json(internal.toApiError());
}
