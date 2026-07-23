/**
 * MCP Tool: purchase_catalog_item
 *
 * Buyer-side x402 purchase flow (TS port of the reference buyer.ts / x402_client.py).
 * Two phases against the seller's x402 server:
 *   1. POST /items/{itemId}/purchase with no X-Payment -> 402 challenge (accepts[0]).
 *   2. Re-POST with an X-Payment envelope carrying a signed EIP-712 PurchaseIntent and
 *      an ERC-3009 TransferWithAuthorization (shared nonce + time window) -> settlement
 *      + ACT grant. Returns { txHash, actHistoryRef, grantorPublicKey }.
 *
 * The grantee public key defaults to this Bee node's ACT publisher key so the granted
 * content is decryptable by the same node that downloads it (download_files_act).
 */
import { Bee } from '@ethersphere/bee-js';
import { ethers } from 'ethers';
import config from '../../config';
import {
  getErrorMessage,
  getResponseWithStructuredContent,
  getToolErrorResponse,
  ToolResponse,
} from '../../utils';
import {
  ActGrantResult,
  PaymentRequirementsAccept,
  PurchaseCatalogItemArgs,
  PurchaseChallenge,
} from './models';

// Mirrors swarm-catalog PURCHASE_INTENT_TYPES. Reused for signing and for the wire
// envelope (no EIP712Domain entry — ethers derives the domain separator itself).
const PURCHASE_INTENT_TYPES = {
  PurchaseIntent: [
    { name: 'itemId', type: 'string' },
    { name: 'granteePublicKey', type: 'bytes' },
    { name: 'payment', type: 'Payment' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
  ],
  Payment: [
    { name: 'scheme', type: 'string' },
    { name: 'asset', type: 'string' },
    { name: 'amount', type: 'uint256' },
    { name: 'payTo', type: 'address' },
  ],
};

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

const ERC20_DOMAIN_ABI = [
  'function name() view returns (string)',
  'function version() view returns (string)',
];

const CHALLENGE_TIMEOUT_MS = 30_000;
const SETTLE_TIMEOUT_MS = 120_000;

// "eip155:84532/erc20:0x833..." -> "0x833..."
function assetAddress(caip19: string): string {
  const idx = caip19.lastIndexOf(':');
  return idx === -1 ? caip19 : caip19.slice(idx + 1);
}

// The facilitator reconstructs the ERC-3009 domain from the token's on-chain
// name/version, so the buyer must sign over the same values. version() is optional on
// ERC-20s; default to "2" (USDC) when absent — matches buyer.ts.
async function tokenDomainMeta(
  provider: ethers.JsonRpcProvider,
  token: string,
): Promise<{ name: string; version: string }> {
  const contract = new ethers.Contract(token, ERC20_DOMAIN_ABI, provider);
  const name: string = await contract.name();
  let version = '2';
  try {
    version = await contract.version();
  } catch {
    version = '2';
  }
  return { name, version };
}

async function granteeKey(args: PurchaseCatalogItemArgs, bee: Bee): Promise<string> {
  if (args.granteePublicKey) {
    return args.granteePublicKey.startsWith('0x')
      ? args.granteePublicKey
      : `0x${args.granteePublicKey}`;
  }
  const addresses = await bee.getNodeAddresses();
  return `0x${addresses.publicKey.toHex()}`;
}

export async function purchaseCatalogItem(
  args: PurchaseCatalogItemArgs,
  bee: Bee,
): Promise<ToolResponse> {
  const walletPk = config.payment.walletPrivateKey;
  if (!walletPk) {
    return getToolErrorResponse('BUYER_WALLET_PK is not set (needed to sign the payment).');
  }
  const rpcUrl = config.payment.rpcUrl;
  if (!rpcUrl) {
    return getToolErrorResponse(
      'PAYMENT_RPC_URL is not set (needed to read the token EIP-712 domain).',
    );
  }
  const endpointBase = args.x402Endpoint || config.payment.x402Endpoint;
  if (!endpointBase) {
    return getToolErrorResponse('Missing x402 endpoint: pass x402Endpoint or set X402_ENDPOINT.');
  }

  const wallet = new ethers.Wallet(walletPk);
  const url = `${endpointBase.replace(/\/+$/, '')}/items/${args.itemId}/purchase`;

  let grantee: string;
  try {
    grantee = await granteeKey(args, bee);
  } catch (err) {
    return getToolErrorResponse(`Unable to read grantee public key: ${getErrorMessage(err)}`);
  }
  const body = JSON.stringify({ granteePublicKey: grantee });

  // Phase 1: 402 challenge.
  let accept: PaymentRequirementsAccept;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(CHALLENGE_TIMEOUT_MS),
    });
    if (res.status !== 402) {
      return getToolErrorResponse(`Expected 402 challenge, got ${res.status}: ${await res.text()}`);
    }
    const challenge = (await res.json()) as PurchaseChallenge;
    const accepts = challenge.accepts ?? [];
    if (accepts.length === 0) {
      return getToolErrorResponse('402 challenge carried no accepts entry.');
    }
    accept = accepts[0];
  } catch (err) {
    return getToolErrorResponse(`x402 challenge request failed: ${getErrorMessage(err)}`);
  }

  const domain = accept.extra?.purchaseIntentDomain;
  if (!domain) {
    return getToolErrorResponse('402 challenge missing extra.purchaseIntentDomain.');
  }

  const asset: string = accept.asset;
  const amount = String(accept.maxAmountRequired);
  const payTo: string = accept.payTo;
  const network: string = accept.network;
  const chainId = Number(domain.chainId);

  // Shared nonce + backdated window (clock skew), as in buyer.ts.
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const validAfter = Math.floor(Date.now() / 1000) - 60;
  const validBefore = validAfter + 3660;

  // Wire form (JSON envelope): amount string, validAfter/validBefore numbers.
  const wireMessage = {
    itemId: args.itemId,
    granteePublicKey: grantee,
    payment: { scheme: 'exact', asset, amount, payTo },
    nonce,
    validAfter,
    validBefore,
  };

  let intentSignature: string;
  let authSignature: string;
  let provider: ethers.JsonRpcProvider;
  try {
    const intentDomain = {
      name: domain.name,
      version: domain.version,
      chainId,
      verifyingContract: ethers.getAddress(domain.verifyingContract),
    };
    const intentMessage = {
      itemId: args.itemId,
      granteePublicKey: grantee,
      payment: {
        scheme: 'exact',
        asset,
        amount: BigInt(amount),
        payTo: ethers.getAddress(payTo),
      },
      nonce,
      validAfter,
      validBefore,
    };
    intentSignature = await wallet.signTypedData(
      intentDomain,
      PURCHASE_INTENT_TYPES,
      intentMessage,
    );

    const token = assetAddress(asset);
    provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    const { name: tokenName, version: tokenVersion } = await tokenDomainMeta(provider, token);
    const authDomain = {
      name: tokenName,
      version: tokenVersion,
      chainId,
      verifyingContract: ethers.getAddress(token),
    };
    const authMessage = {
      from: wallet.address,
      to: ethers.getAddress(payTo),
      value: BigInt(amount),
      validAfter,
      validBefore,
      nonce,
    };
    authSignature = await wallet.signTypedData(
      authDomain,
      TRANSFER_WITH_AUTHORIZATION_TYPES,
      authMessage,
    );
  } catch (err) {
    return getToolErrorResponse(`Failed to build/sign payment: ${getErrorMessage(err)}`);
  }

  const envelope = {
    x402Version: 1,
    scheme: 'exact',
    network,
    payload: {
      purchaseIntent: {
        domain,
        types: PURCHASE_INTENT_TYPES,
        primaryType: 'PurchaseIntent',
        message: wireMessage,
        signature: intentSignature,
      },
      authorization: {
        from: wallet.address,
        to: payTo,
        value: amount,
        validAfter,
        validBefore,
        nonce,
        signature: authSignature,
      },
    },
  };
  const xPayment = Buffer.from(JSON.stringify(envelope), 'utf-8').toString('base64');

  // Phase 2: settle + ACT grant.
  let result: ActGrantResult;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Payment': xPayment },
      body,
      signal: AbortSignal.timeout(SETTLE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return getToolErrorResponse(`Purchase failed (${res.status}): ${await res.text()}`);
    }
    result = (await res.json()) as ActGrantResult;
  } catch (err) {
    return getToolErrorResponse(`x402 settlement request failed: ${getErrorMessage(err)}`);
  }

  return getResponseWithStructuredContent({
    itemId: args.itemId,
    granteePublicKey: grantee,
    txHash: result.txHash,
    actHistoryRef: result.actHistoryRef,
    grantorPublicKey: result.grantorPublicKey,
    message: `Purchased ${args.itemId}; ACT grant issued to the buyer node.`,
  });
}
