import { PurchaseError, sendError } from '../src/errors.js';

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('PurchaseError', () => {
  it('maps each code to the spec HTTP status and retryable flag (§15.2)', () => {
    expect(new PurchaseError('item_not_found', 'x').status).toBe(404);
    expect(new PurchaseError('item_retired', 'x').status).toBe(410);
    expect(new PurchaseError('intent_replay', 'x').status).toBe(409);
    expect(new PurchaseError('payment_verify_failed', 'x').status).toBe(402);
    expect(new PurchaseError('payment_settle_failed', 'x').status).toBe(502);
    expect(new PurchaseError('payment_settle_failed', 'x').retryable).toBe(true);
    expect(new PurchaseError('intent_signature_invalid', 'x').retryable).toBe(false);
    expect(new PurchaseError('intent_not_yet_valid', 'x').retryable).toBe(true);
  });

  it('serializes to the ApiError envelope, including details only when present', () => {
    const withDetails = new PurchaseError('intent_payment_mismatch', 'nope', { a: 1 }).toApiError();
    expect(withDetails).toEqual({
      error: 'intent_payment_mismatch',
      message: 'nope',
      details: { a: 1 },
      retryable: false,
    });

    const withoutDetails = new PurchaseError('item_not_found', 'gone').toApiError();
    expect(withoutDetails).not.toHaveProperty('details');
  });
});

describe('sendError', () => {
  it('emits a PurchaseError with its mapped status', () => {
    const res = fakeRes();
    sendError(res as never, new PurchaseError('intent_replay', 'used'));
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ error: 'intent_replay', retryable: false });
  });

  it('wraps an unknown error as internal_error 500', () => {
    const res = fakeRes();
    sendError(res as never, new Error('boom'));
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: 'internal_error', message: 'boom', retryable: true });
  });
});
