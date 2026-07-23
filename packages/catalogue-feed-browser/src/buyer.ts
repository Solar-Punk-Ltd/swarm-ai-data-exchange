import { createPublicClient, http, type Address, type Hex, type LocalAccount } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { randomBytes } from 'node:crypto';
import {
  PURCHASE_INTENT_TYPES,
  type ActGrantResult,
  type ApiError,
  type Eip712Domain,
  type PurchaseIntentMessage,
  type PurchasePayload,
} from '@solarpunk/swarm-catalog';

export interface PurchaseParams {
  publisherEndpoint: string; // full URL, e.g. https://publisher/v1/items/:itemId/purchase
  itemId: string;
  granteePublicKey: string; // consumer's Bee-node public key (0x04...)
  walletSigner: LocalAccount; // viem account for EIP-712 + ERC-3009 signing
}

// Subset of the x402 v1 402 challenge body we read.
interface X402Accept {
  scheme: string;
  network: string; // CAIP-2
  asset: string; // CAIP-19
  maxAmountRequired: string;
  payTo: string;
  resource?: string;
  extra?: {
    facilitator?: string;
    purchaseIntentVersion?: string;
    purchaseIntentDomain?: Eip712Domain;
  };
}
interface X402Challenge {
  x402Version: number;
  error?: string;
  accepts: X402Accept[];
}

// ERC-3009 transferWithAuthorization typed-data (signed over the token contract's EIP-712 domain).
const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

const ERC20_NAME_ABI = [
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const;
const ERC20_VERSION_ABI = [
  {
    name: 'version',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const;

// CAIP-19 "eip155:84532/erc20:0x833..." → "0x833..."
function assetAddress(caip19: string): Address {
  const idx = caip19.lastIndexOf(':');
  return (idx === -1 ? caip19 : caip19.slice(idx + 1)) as Address;
}

function chainForId(chainId: number) {
  switch (chainId) {
    case base.id:
      return base;
    case baseSepolia.id:
      return baseSepolia;
    default:
      throw new Error(`Unsupported chainId ${chainId} for token domain lookup`);
  }
}

// Read the token's EIP-712 domain fields (name/version) for the ERC-3009 authorization.
// version() is optional on ERC-20s; default to "2" (USDC) when absent.
async function tokenDomainMeta(
  chainId: number,
  token: Address,
): Promise<{ name: string; version: string }> {
  const client = createPublicClient({ chain: chainForId(chainId), transport: http() });
  const [name, version] = await Promise.all([
    client.readContract({ address: token, abi: ERC20_NAME_ABI, functionName: 'name' }),
    client
      .readContract({ address: token, abi: ERC20_VERSION_ABI, functionName: 'version' })
      .catch(() => '2'),
  ]);
  return { name, version };
}

async function parseApiError(res: Response): Promise<never> {
  let body: ApiError | { error?: string; message?: string } | undefined;
  try {
    body = (await res.json()) as ApiError;
  } catch {
    /* non-JSON body */
  }
  const code = body?.error ?? `http_${res.status}`;
  const message = body?.message ?? `Purchase failed (${res.status})`;
  throw new Error(`${code}: ${message}`);
}

// Consumer side of §10.1 / §11.4. The PurchaseIntent and the ERC-3009 authorization share the
// same nonce and time window — a hard invariant the server checks at steps 3–6 of its verification.
export async function purchase(params: PurchaseParams): Promise<ActGrantResult> {
  const { publisherEndpoint, itemId, granteePublicKey, walletSigner } = params;

  // Step 1: POST without X-Payment → receive the 402 challenge.
  const challengeRes = await fetch(publisherEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ granteePublicKey }),
  });
  if (challengeRes.status !== 402) {
    await parseApiError(challengeRes); // item_not_found / item_retired / etc. surface here
  }
  const challenge = (await challengeRes.json()) as X402Challenge;

  // Step 2: select an accepts entry.
  const accept = challenge.accepts?.[0];
  if (!accept) throw new Error('402 challenge carried no accepts entry');
  const domain = accept.extra?.purchaseIntentDomain;
  if (!domain) throw new Error('402 challenge missing extra.purchaseIntentDomain');

  // Step 3: random nonce + time window, shared by both signatures (small backdate for clock skew).
  const nonce = `0x${randomBytes(32).toString('hex')}` as Hex;
  const validAfter = Math.floor(Date.now() / 1000) - 60;
  const validBefore = validAfter + 3660;

  // Step 4: build the PurchaseIntentMessage.
  const message: PurchaseIntentMessage = {
    itemId,
    granteePublicKey,
    payment: {
      scheme: 'exact',
      asset: accept.asset,
      amount: accept.maxAmountRequired,
      payTo: accept.payTo,
    },
    nonce,
    validAfter,
    validBefore,
  };

  // Step 5: sign the PurchaseIntent (EIP-712) over the advertised domain.
  const intentSignature = await walletSigner.signTypedData({
    domain: {
      name: domain.name,
      version: domain.version,
      chainId: domain.chainId,
      verifyingContract: domain.verifyingContract as Address,
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
        payTo: message.payment.payTo as Address,
      },
      nonce,
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
    },
  });

  // Step 6: sign the ERC-3009 transferWithAuthorization — same wallet, nonce, and window.
  const token = assetAddress(accept.asset);
  const { name: tokenName, version: tokenVersion } = await tokenDomainMeta(domain.chainId, token);
  const authSignature = await walletSigner.signTypedData({
    domain: {
      name: tokenName,
      version: tokenVersion,
      chainId: domain.chainId,
      verifyingContract: token,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES as unknown as Record<
      string,
      { name: string; type: string }[]
    >,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: walletSigner.address,
      to: accept.payTo as Address,
      value: BigInt(message.payment.amount),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce,
    },
  });

  // Step 7: assemble the PurchasePayload envelope and base64-encode it for the X-Payment header.
  const envelope: PurchasePayload = {
    x402Version: 1,
    scheme: 'exact',
    network: accept.network,
    payload: {
      purchaseIntent: {
        domain,
        types: PURCHASE_INTENT_TYPES,
        primaryType: 'PurchaseIntent',
        message,
        signature: intentSignature,
      },
      authorization: {
        from: walletSigner.address,
        to: accept.payTo,
        value: message.payment.amount,
        validAfter,
        validBefore,
        nonce,
        signature: authSignature,
      },
    },
  };
  const xPayment = Buffer.from(JSON.stringify(envelope)).toString('base64');

  // Step 8: POST again with the X-Payment header.
  const settleRes = await fetch(publisherEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Payment': xPayment },
    body: JSON.stringify({ granteePublicKey }),
  });
  if (!settleRes.ok) {
    await parseApiError(settleRes);
  }

  // Step 9: return the ActGrantResult.
  return (await settleRes.json()) as ActGrantResult;
}
