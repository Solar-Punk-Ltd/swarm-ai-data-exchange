import type { Request, Response } from 'express';
import { Bee } from '@ethersphere/bee-js';
import {
  writeItemState,
  type ActGrantResult,
  type CatalogItemState,
} from '@solarpunk/swarm-catalog';
import { parseChainId, type ServerConfig } from './config.js';
import { PurchaseError, sendError } from './errors.js';
import { CatalogCache, type CatalogLookup } from './catalog.js';
import { decodeXPayment, verifyPurchaseIntent } from './intent.js';
import { grantActAccess } from './act.js';
import { FacilitatorClient } from './facilitator.js';
import { Store } from './db.js';
import { createVoucherWallet, VoucherError, type VoucherFunder } from './voucher.js';

const DOMAIN_NAME = 'Swarm AI Data Exchange';
const DOMAIN_VERSION = '1';

const DEFAULT_STATE_FEED_RETRY = { attempts: 8, baseDelayMs: 500, maxDelayMs: 30_000 };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Advance the per-item state feed, retrying with exponential backoff until it converges (§14.1).
// The ACT grant is already issued when this runs, so a failure never affects the consumer — but the
// publisher's on-Swarm record MUST catch up, so we keep retrying. Never throws: on exhaustion it
// logs `state_feed_failed` for operational follow-up. Durable retry across restarts is out of scope.
async function persistStateWithRetry(
  bee: Bee,
  config: ServerConfig,
  state: CatalogItemState,
): Promise<void> {
  const { attempts, baseDelayMs, maxDelayMs } = config.stateFeedRetry ?? DEFAULT_STATE_FEED_RETRY;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await writeItemState(
        bee,
        config.itemStateFeedPk,
        config.catalogFeedOwner,
        state,
        config.postageBatchId,
      );
      if (attempt > 1) {
        console.info(`[state_feed] item ${state.itemId}: converged after ${attempt} attempts`);
      }
      return;
    } catch (err) {
      if (attempt === attempts) {
        console.error(
          `[state_feed_failed] item ${state.itemId}: exhausted ${attempts} attempts; ` +
            `grant already issued, manual reconciliation required:`,
          err,
        );
        return;
      }
      console.error(
        `[state_feed] item ${state.itemId}: write attempt ${attempt}/${attempts} failed, retrying:`,
        err,
      );
      await sleep(Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs));
    }
  }
}

interface Deps {
  bee: Bee;
  store: Store;
  facilitator: FacilitatorClient;
  config: ServerConfig;
  funder: VoucherFunder;
  catalog: CatalogCache;
}

// The devcon8 response: the standard ActGrantResult plus `data`, a JSON string carrying the
// voucher wallet. swarm-market-mcp passes `data` through verbatim; the shape inside it is the
// contract with the Claim Wallet page.
type VoucherGrantResult = ActGrantResult & { data?: string };

// The grantor public key is this publisher Bee node's own key (the ACT grantor returned to the
// consumer so it can decrypt). It never changes for a running node, so cache after the first read.
let grantorPublicKeyCache: string | undefined;
async function getGrantorPublicKey(bee: Bee): Promise<string> {
  if (grantorPublicKeyCache) return grantorPublicKeyCache;
  const addresses = await bee.getNodeAddresses();
  // Return raw 64-byte X||Y (128 hex chars, no 0x prefix). swarm-mcp's download_files
  // expects this form and prepends the 04 SEC1 prefix internally before setting the
  // Swarm-Act-Publisher header.
  grantorPublicKeyCache = addresses.publicKey.toHex().replace(/^0x/, '');
  return grantorPublicKeyCache;
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
  const { bee, store, facilitator, config, funder, catalog } = deps;

  return async (req: Request, res: Response): Promise<void> => {
    const itemId = req.params.itemId;
    try {
      // Catalog lookup prerequisite — runs before the X-Payment branch; early return on any miss.
      // Memoised: this is the second time a paying buyer pays for it, the first being the 402
      // challenge it just received. See CatalogCache.
      const lookup = await catalog.lookup(itemId);
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
        expectedPayTo: config.splitterAddress,
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
      store.recordPurchase(consumerAddress, itemId, txHash, settledAt, matched.payTo);

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

      // Step 11's payload, built here rather than after the response because the in-memory
      // state has to advance NOW: the voucher funding below spends ~9s on Gnosis, and a
      // purchase arriving inside that window must chain its grant from these refs, not from
      // the ones this request started with. The feed write itself still happens post-response.
      const newState: CatalogItemState = {
        ...lookup.state,
        actHistoryRef: grant.actHistoryRef,
        granteeRef: grant.granteeRef,
        dateModified: grantedAt,
      };
      catalog.noteGrant(itemId, newState);

      // ── devcon8 voucher: mint + fund a wallet for this settlement ──────────────────────
      // Runs AFTER the money moved (nothing to vend before that) and BEFORE the response
      // (the visitor must only ever be shown a key that is already worth something). The
      // private key lives exclusively in this stack frame and the response body: the sqlite
      // row records the address alone, for double-fund protection and operator accounting.
      const data = await issueVoucher(store, funder, txHash);

      // Step 12: return the ActGrantResult. The grant is already issued, so the consumer has
      // everything it needs; the state-feed write (step 11) MUST NOT delay or fail the response.
      const result: VoucherGrantResult = {
        itemId,
        actHistoryRef: grant.actHistoryRef,
        grantTo: granteePublicKey,
        grantorPublicKey: await getGrantorPublicKey(bee),
        reference: itemId,
        txHash,
        grantedAt,
        data,
      };
      res.status(200).json(result);

      // Step 11: advance the state feed after responding — non-fatal for the grant but MUST
      // converge (§14.1), so retry with backoff. Runs post-response; retries never block the
      // consumer. The value was built above, where `...lookup.state` carried
      // `catalogRootAtUpdate`/`version`/`lifecycle` forward.
      //
      // This is now purely for external readers — buyers checking the item is purchasable
      // before they bid. This server's own next grant reads the in-memory cell, so a feed
      // write that is still retrying no longer holds up the sale behind it.
      await persistStateWithRetry(bee, config, newState);
    } catch (err) {
      sendError(res, err);
    }
  };
}

// Mint a wallet for one settlement, fund it, and return the `data` payload. Never throws:
// the payment is already settled when this runs, so every failure path must still hand the
// visitor whatever can honestly be handed over.
//
// - Normal path: fresh keypair → record the ADDRESS (never the key) keyed on the settle tx →
//   fund 0.001 xBZZ + 0.001 xDAI → mark funded → return {address, privateKey, funded: true}.
// - Funding failure: the key is STILL returned, with funded: false. The row's funded=0 marks
//   the address for a manual top-up; returning an error instead would take the visitor's
//   payment and give nothing back.
// - Duplicate settle tx (defense in depth — the nonce burn already 409s a replayed envelope):
//   respond without minting again. There is no key to re-deliver, by design.
async function issueVoucher(
  store: Store,
  funder: VoucherFunder,
  settleTx: string,
): Promise<string> {
  const existing = store.getVoucher(settleTx);
  if (existing) {
    console.warn(
      `[voucher] duplicate settle tx ${settleTx}; wallet ${existing.address} already issued`,
    );
    return JSON.stringify({
      type: 'devcon8-voucher',
      address: existing.address,
      funded: existing.funded === 1,
      fundTx: existing.fund_tx ?? undefined,
      note: 'already issued; the private key was delivered once and is not stored',
    });
  }

  const wallet = createVoucherWallet();
  store.recordVoucher(settleTx, wallet.address);
  try {
    const fundResult = await funder.fund(wallet.address);
    store.markVoucherFunded(settleTx, fundResult.xbzzTx);
    console.log(
      `[voucher] funded ${wallet.address} for settle ${settleTx} ` +
        `(xdai ${fundResult.xdaiTx}, xbzz ${fundResult.xbzzTx})`,
    );
    return JSON.stringify({
      type: 'devcon8-voucher',
      address: wallet.address,
      privateKey: wallet.privateKey,
      funded: true,
      fundTx: { xdai: fundResult.xdaiTx, xbzz: fundResult.xbzzTx },
    });
  } catch (err) {
    const reason = err instanceof VoucherError ? err.message : String(err);
    console.error(`[voucher] funding FAILED for ${wallet.address} (settle ${settleTx}): ${reason}`);
    return JSON.stringify({
      type: 'devcon8-voucher',
      address: wallet.address,
      privateKey: wallet.privateKey,
      funded: false,
      error: 'funding failed; keep this key — the address can be topped up',
    });
  }
}
