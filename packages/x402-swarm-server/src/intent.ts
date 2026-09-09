import { recoverTypedDataAddress, type Hex } from 'viem';
import {
  PURCHASE_INTENT_TYPES,
  type PaymentRequirements,
  type PurchasePayload,
} from '@solarpunk/swarm-catalog';
import { parseChainId } from './config.js';
import { PurchaseError } from './errors.js';
import type { MatchedPayment } from './facilitator.js';

// Step 1: decode the base64 X-Payment header into a PurchaseIntent envelope.
export function decodeXPayment(header: string): PurchasePayload {
  let json: string;
  try {
    json = Buffer.from(header, 'base64').toString('utf8');
  } catch {
    throw new PurchaseError('intent_malformed', 'X-Payment header is not valid base64');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new PurchaseError('intent_malformed', 'X-Payment header is not valid JSON');
  }
  const envelope = parsed as PurchasePayload;
  if (!envelope?.payload?.purchaseIntent?.message || !envelope.payload.authorization) {
    throw new PurchaseError('intent_malformed', 'X-Payment envelope is missing required fields');
  }
  return envelope;
}

export interface VerifiedIntent {
  consumerAddress: string; // recovered EOA = payer
  matched: MatchedPayment;
}

interface VerifyOpts {
  pathItemId: string;
  chainId: number;
  domainContract: string;
  itemPayments: PaymentRequirements[];
  isNonceUsed: (nonce: string) => boolean;
  now: number; // unix seconds
  // Optional marketplace guard: the seller's split contract. When set, the matched payment's
  // payTo must equal it.
  expectedPayTo?: string;
}

// §11.5 steps 2–7 (reversible checks). Step 1 (decode) runs separately; steps 8–11 are committing.
export async function verifyPurchaseIntent(
  envelope: PurchasePayload,
  opts: VerifyOpts,
): Promise<VerifiedIntent> {
  const { domain, message, signature } = envelope.payload.purchaseIntent;
  const auth = envelope.payload.authorization;

  // §11.4 co-signing invariants: intent and authorization must describe the same payment.
  if (
    message.payment.amount !== auth.value ||
    message.payment.payTo.toLowerCase() !== auth.to.toLowerCase() ||
    message.nonce.toLowerCase() !== auth.nonce.toLowerCase() ||
    message.validAfter !== auth.validAfter ||
    message.validBefore !== auth.validBefore
  ) {
    throw new PurchaseError(
      'intent_malformed',
      'PurchaseIntent message and authorization are inconsistent',
    );
  }

  // Step 2: verify the EIP-712 signature recovers the payer EOA.
  let recovered: string;
  try {
    recovered = await recoverTypedDataAddress({
      domain: {
        name: domain.name,
        version: domain.version,
        chainId: domain.chainId,
        verifyingContract: domain.verifyingContract as Hex,
      },
      types: PURCHASE_INTENT_TYPES as unknown as Record<string, { name: string; type: string }[]>,
      primaryType: 'PurchaseIntent',
      message: {
        itemId: message.itemId,
        granteePublicKey: message.granteePublicKey as Hex,
        payment: {
          scheme: message.payment.scheme,
          asset: message.payment.asset,
          amount: BigInt(message.payment.amount),
          payTo: message.payment.payTo as Hex,
        },
        nonce: message.nonce as Hex,
        validAfter: BigInt(message.validAfter),
        validBefore: BigInt(message.validBefore),
      },
      signature: signature as Hex,
    });
  } catch (err) {
    throw new PurchaseError(
      'intent_signature_invalid',
      'EIP-712 signature could not be recovered',
      {
        reason: err instanceof Error ? err.message : String(err),
      },
    );
  }
  if (recovered.toLowerCase() !== auth.from.toLowerCase()) {
    throw new PurchaseError(
      'intent_signature_invalid',
      'EIP-712 signature did not recover the expected payer EOA',
      { expected: auth.from, recovered },
    );
  }

  // Step 3: domain match against advertised values.
  const advertisedChainIds = new Set(opts.itemPayments.map((p) => parseChainId(p.chainId)));
  if (
    domain.verifyingContract.toLowerCase() !== opts.domainContract.toLowerCase() ||
    !advertisedChainIds.has(domain.chainId)
  ) {
    throw new PurchaseError(
      'intent_domain_mismatch',
      'PurchaseIntent domain does not match advertised values',
      {
        expectedContract: opts.domainContract,
        gotContract: domain.verifyingContract,
        gotChainId: domain.chainId,
      },
    );
  }

  // Step 4: item match.
  if (message.itemId !== opts.pathItemId) {
    throw new PurchaseError(
      'intent_item_mismatch',
      'PurchaseIntent itemId does not match the path',
      {
        pathItemId: opts.pathItemId,
        intentItemId: message.itemId,
      },
    );
  }

  // Step 5: payment match against the item's advertised accepts entries.
  const match = opts.itemPayments.find(
    (p) =>
      p.scheme === message.payment.scheme &&
      p.asset === message.payment.asset &&
      p.amount === message.payment.amount &&
      p.payTo.toLowerCase() === message.payment.payTo.toLowerCase() &&
      parseChainId(p.chainId) === domain.chainId,
  );
  if (!match) {
    throw new PurchaseError(
      'intent_payment_mismatch',
      'PurchaseIntent payment does not match any advertised accepts entry',
      {
        intentAmount: message.payment.amount,
        advertisedAmounts: opts.itemPayments.map((p) => p.amount),
      },
    );
  }

  // Step 5b: settlement destination must be the seller's split contract. A catalog entry that
  // still advertises a bare EOA would settle untaxed and produce no valid Proof-of-Purchase, so
  // it is rejected here — before /settle, while the failure is still free.
  if (opts.expectedPayTo && match.payTo.toLowerCase() !== opts.expectedPayTo.toLowerCase()) {
    throw new PurchaseError(
      'payment_destination_untaxed',
      'Advertised payTo is not this seller’s split contract; republish the item',
      { expectedPayTo: opts.expectedPayTo, advertisedPayTo: match.payTo },
    );
  }

  // Step 6: time window.
  if (opts.now < message.validAfter) {
    throw new PurchaseError('intent_not_yet_valid', 'PurchaseIntent is not yet valid', {
      validAfter: message.validAfter,
      now: opts.now,
    });
  }
  if (opts.now > message.validBefore) {
    throw new PurchaseError('intent_expired', 'PurchaseIntent has expired', {
      validBefore: message.validBefore,
      now: opts.now,
    });
  }

  // Step 7: nonce freshness (read-only; nonce is burned at step 9 after settlement).
  if (opts.isNonceUsed(message.nonce)) {
    throw new PurchaseError('intent_replay', 'PurchaseIntent nonce has already been used', {
      nonce: message.nonce,
    });
  }

  return {
    consumerAddress: recovered,
    matched: {
      network: match.chainId,
      asset: match.asset,
      amount: match.amount,
      payTo: match.payTo,
    },
  };
}
