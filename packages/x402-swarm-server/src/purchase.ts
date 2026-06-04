import type { Request, Response } from 'express';
import { Bee } from '@ethersphere/bee-js';
import {
  writeItemState,
  type ActGrantResult,
  type CatalogItemState,
} from '@solarpunk/swarm-catalog';
import { parseChainId, type ServerConfig } from './config.js';
import { PurchaseError, sendError } from './errors.js';
import { lookupItem, type CatalogLookup } from './catalog.js';
import { decodeXPayment, verifyPurchaseIntent } from './intent.js';
import { grantActAccess } from './act.js';
import { FacilitatorClient } from './facilitator.js';
import { Store } from './db.js';

const DOMAIN_NAME = 'Swarm AI Data Exchange';
const DOMAIN_VERSION = '1';

interface Deps {
  bee: Bee;
  store: Store;
  facilitator: FacilitatorClient;
  config: ServerConfig;
}

// Phase 1 body: x402 v1 challenge with the EIP-712 domain in extra.purchaseIntentDomain (§10.2).
function buildChallenge(lookup: CatalogLookup, resource: string, config: ServerConfig) {
  return {
    x402Version: 1,
    error: 'payment_required',
    accepts: lookup.payments.map((p) => ({
      scheme: p.scheme,
      network: p.chainId,
      asset: p.asset,
      maxAmountRequired: p.amount,
      payTo: p.payTo,
      resource,
      description: p.description ?? lookup.description,
      mimeType: 'application/json',
      maxTimeoutSeconds: 600,
      extra: {
        facilitator: p.facilitator ?? config.facilitatorUrl,
        purchaseIntentVersion: '1',
        purchaseIntentDomain: {
          name: DOMAIN_NAME,
          version: DOMAIN_VERSION,
          chainId: parseChainId(p.chainId),
          verifyingContract: config.purchaseIntentDomainContract,
        },
      },
    })),
  };
}

// POST /v1/items/:itemId/purchase — three-phase flow (§10.1) with the 12-step verification (§11.5).
export function purchaseHandler(deps: Deps) {
  const { bee, store, facilitator, config } = deps;

  return async (req: Request, res: Response): Promise<void> => {
    const itemId = req.params.itemId;
    try {
      // Catalog lookup prerequisite — runs before the X-Payment branch; early return on any miss.
      const lookup = await lookupItem(bee, config.catalogFeedOwner, itemId);
      const resource = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

      const xPayment = req.header('X-Payment');

      // Phase 1: no payment header → 402 challenge.
      if (!xPayment) {
        res.status(402).json(buildChallenge(lookup, resource, config));
        return;
      }

      // Phase 2, steps 1–7 (reversible): decode + verify the PurchaseIntent.
      const envelope = decodeXPayment(xPayment);
      const { consumerAddress, matched } = await verifyPurchaseIntent(envelope, {
        pathItemId: itemId,
        chainId: config.chainId,
        domainContract: config.purchaseIntentDomainContract,
        itemPayments: lookup.payments,
        isNonceUsed: (n) => store.isNonceUsed(n),
        now: Math.floor(Date.now() / 1000),
      });

      // Step 8: Facilitator /verify.
      const verifyResult = await facilitator.verify(envelope, matched, resource);
      if (!verifyResult.isValid) {
        throw new PurchaseError(
          'payment_verify_failed',
          verifyResult.invalidReason ?? 'Facilitator rejected the payment authorization',
        );
      }

      // ── POINT OF NO RETURN ──
      // Step 9: Facilitator /settle.
      let settle;
      try {
        settle = await facilitator.settle(envelope, matched, resource);
      } catch (err) {
        throw new PurchaseError('payment_settle_failed', 'Facilitator settlement failed', {
          reason: err instanceof Error ? err.message : String(err),
        });
      }
      if (!settle.success || !settle.transaction) {
        throw new PurchaseError(
          'payment_settle_failed',
          settle.errorReason ?? 'Facilitator settlement did not return a transaction',
        );
      }
      const txHash = settle.transaction;
      const settledAt = new Date().toISOString();

      // Step 9 (cont): burn the nonce + write the purchase record (before the grant).
      const nonce = envelope.payload.purchaseIntent.message.nonce;
      store.recordNonce(nonce);
      store.recordPurchase(consumerAddress, itemId, txHash, settledAt);

      // Step 10: issue the ACT grant (retryable — publisher MUST retry on failure).
      const granteePublicKey = envelope.payload.purchaseIntent.message.granteePublicKey;
      let grant;
      try {
        grant = await grantActAccess(
          bee,
          config.postageBatchId,
          lookup.state.granteeRef,
          lookup.state.actHistoryRef,
          granteePublicKey,
        );
      } catch (err) {
        throw new PurchaseError('act_grant_failed', 'ACT grant failed after settlement', {
          reason: err instanceof Error ? err.message : String(err),
        });
      }
      const grantedAt = new Date().toISOString();

      // Step 11: state-feed write — non-fatal. Grant already issued; log and move on.
      try {
        const newState: CatalogItemState = {
          ...lookup.state,
          actHistoryRef: grant.actHistoryRef,
          granteeRef: grant.granteeRef,
          catalogRootAtUpdate: lookup.state.catalogRootAtUpdate,
          dateModified: grantedAt,
        };
        await writeItemState(
          bee,
          config.itemStateFeedPk,
          config.catalogFeedOwner,
          newState,
          config.postageBatchId,
        );
      } catch (err) {
        console.error(`[state_feed_failed] item ${itemId}:`, err);
      }

      // Step 12: return ActGrantResult.
      const result: ActGrantResult = {
        itemId,
        actHistoryRef: grant.actHistoryRef,
        grantTo: granteePublicKey,
        reference: itemId,
        txHash,
        grantedAt,
      };
      res.status(200).json(result);
    } catch (err) {
      sendError(res, err);
    }
  };
}
