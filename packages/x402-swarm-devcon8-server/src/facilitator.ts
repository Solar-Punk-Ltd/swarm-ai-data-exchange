import type { PurchasePayload } from '@solarpunk/swarm-catalog';
import { createPublicClient, http, type Address, type Chain } from 'viem';
import { base, baseSepolia, celo, celoSepolia } from 'viem/chains';

// CAIP-19 "eip155:8453/erc20:0x8335..." → "0x8335..."
export function assetAddressFromCaip19(asset: string): string {
  const idx = asset.lastIndexOf(':');
  return idx === -1 ? asset : asset.slice(idx + 1);
}

// The x402 v1 facilitator API registers schemes by network NAME, not CAIP-2. Translate
// "eip155:84532" → "base-sepolia" before calling /verify and /settle, otherwise the
// facilitator returns "No facilitator registered for scheme: exact and network: eip155:84532".
// Celo's hosted facilitator advertises the v1 names below on its /supported endpoint.
const CAIP2_TO_X402_NETWORK: Record<string, string> = {
  'eip155:84532': 'base-sepolia',
  'eip155:8453': 'base',
  'eip155:11142220': 'celo-sepolia',
  'eip155:42220': 'celo',
};
export function x402NetworkName(caip2: string): string {
  const name = CAIP2_TO_X402_NETWORK[caip2];
  if (!name) {
    throw new Error(`No x402 network name mapping for CAIP-2 network "${caip2}"`);
  }
  return name;
}

// Chains this server can read a token's EIP-712 domain on. An unknown chain id throws rather
// than falling back to Base: a domain read against the wrong chain yields a `name`/`version`
// the buyer never signed over, which surfaces much later as an opaque facilitator rejection.
const CHAINS_BY_ID: Record<number, Chain> = {
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
  [celo.id]: celo,
  [celoSepolia.id]: celoSepolia,
};
export function chainForCaip2(caip2: string): Chain {
  const chainId = Number(caip2.split(':').pop());
  const chain = CHAINS_BY_ID[chainId];
  if (!chain) {
    throw new Error(
      `No viem chain for CAIP-2 network "${caip2}"; supported: ${Object.keys(CHAINS_BY_ID).join(', ')}`,
    );
  }
  return chain;
}

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

// Read the token's EIP-712 domain (name/version) for the ERC-3009 authorization, mirroring the
// consumer (catalogue-feed-browser buyer.ts) exactly so the facilitator reconstructs the same
// domain the buyer signed. version() is optional on ERC-20s; default to "2" (USDC) when absent.
// Cached per token — verify() and settle() both need it within one purchase.
const tokenDomainCache = new Map<string, { name: string; version: string }>();
async function tokenDomainMeta(
  caip2Network: string,
  token: Address,
  rpcUrl?: string,
): Promise<{ name: string; version: string }> {
  const cacheKey = `${caip2Network}:${token.toLowerCase()}`;
  const cached = tokenDomainCache.get(cacheKey);
  if (cached) return cached;

  const chain = chainForCaip2(caip2Network);
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const [name, version] = await Promise.all([
    client.readContract({ address: token, abi: ERC20_NAME_ABI, functionName: 'name' }),
    client
      .readContract({ address: token, abi: ERC20_VERSION_ABI, functionName: 'version' })
      .catch(() => '2'),
  ]);
  const meta = { name, version };
  tokenDomainCache.set(cacheKey, meta);
  return meta;
}

// Standard x402 ExactEvm payment payload built from the consumer's ERC-3009 authorization.
interface ExactEvmPayload {
  x402Version: 1;
  scheme: 'exact';
  network: string;
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  };
}

// Standard x402 payment requirements the facilitator validates the authorization against.
interface PaymentRequirementsWire {
  scheme: 'exact';
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; version: string };
}

export interface VerifyResult {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface SettleResult {
  success: boolean;
  transaction?: string; // txHash
  network?: string;
  payer?: string;
  errorReason?: string;
}

export interface MatchedPayment {
  network: string; // CAIP-2
  asset: string; // CAIP-19
  amount: string;
  payTo: string;
  // The facilitator the catalog item named for this rail, when it named one.
  facilitator?: string;
}

export interface FacilitatorClientOptions {
  // Sent as `X-API-Key` on every call. Celo's hosted facilitator gates /settle on it.
  apiKey?: string;
  // RPC per CAIP-2 network for the token EIP-712 domain read; viem's default otherwise.
  rpcUrls?: Record<string, string>;
}

// Thin HTTP client for the x402 Facilitator's /verify and /settle endpoints.
export class FacilitatorClient {
  private readonly apiKey?: string;
  private readonly rpcUrls: Record<string, string>;

  constructor(
    private readonly baseUrl: string,
    opts: FacilitatorClientOptions = {},
  ) {
    this.apiKey = opts.apiKey;
    this.rpcUrls = opts.rpcUrls ?? {};
  }

  private toPaymentPayload(envelope: PurchasePayload, network: string): ExactEvmPayload {
    const auth = envelope.payload.authorization;
    return {
      x402Version: 1,
      scheme: 'exact',
      network: x402NetworkName(network),
      payload: {
        signature: auth.signature,
        authorization: {
          from: auth.from,
          to: auth.to,
          value: auth.value,
          validAfter: String(auth.validAfter),
          validBefore: String(auth.validBefore),
          nonce: auth.nonce,
        },
      },
    };
  }

  private async toRequirements(
    matched: MatchedPayment,
    resource: string,
  ): Promise<PaymentRequirementsWire> {
    const asset = assetAddressFromCaip19(matched.asset) as Address;
    const extra = await tokenDomainMeta(matched.network, asset, this.rpcUrls[matched.network]);
    return {
      scheme: 'exact',
      network: x402NetworkName(matched.network),
      maxAmountRequired: matched.amount,
      resource,
      description: '',
      mimeType: 'application/json',
      payTo: matched.payTo,
      maxTimeoutSeconds: 600,
      asset,
      // The facilitator's exact-EVM verifier reconstructs the ERC-3009 EIP-712 domain from this.
      extra,
    };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Facilitator ${path} returned ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  async verify(
    envelope: PurchasePayload,
    matched: MatchedPayment,
    resource: string,
  ): Promise<VerifyResult> {
    return this.post<VerifyResult>('/verify', {
      x402Version: 1,
      paymentPayload: this.toPaymentPayload(envelope, matched.network),
      paymentRequirements: await this.toRequirements(matched, resource),
    });
  }

  async settle(
    envelope: PurchasePayload,
    matched: MatchedPayment,
    resource: string,
  ): Promise<SettleResult> {
    return this.post<SettleResult>('/settle', {
      x402Version: 1,
      paymentPayload: this.toPaymentPayload(envelope, matched.network),
      paymentRequirements: await this.toRequirements(matched, resource),
    });
  }
}
