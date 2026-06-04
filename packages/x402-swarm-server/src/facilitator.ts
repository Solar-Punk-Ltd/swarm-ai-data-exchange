import type { PurchasePayload } from '@solarpunk/swarm-catalog';

// CAIP-19 "eip155:8453/erc20:0x8335..." → "0x8335..."
export function assetAddressFromCaip19(asset: string): string {
  const idx = asset.lastIndexOf(':');
  return idx === -1 ? asset : asset.slice(idx + 1);
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
}

// Thin HTTP client for the x402 Facilitator's /verify and /settle endpoints.
export class FacilitatorClient {
  constructor(private readonly baseUrl: string) {}

  private toPaymentPayload(envelope: PurchasePayload, network: string): ExactEvmPayload {
    const auth = envelope.payload.authorization;
    return {
      x402Version: 1,
      scheme: 'exact',
      network,
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

  private toRequirements(matched: MatchedPayment, resource: string): PaymentRequirementsWire {
    return {
      scheme: 'exact',
      network: matched.network,
      maxAmountRequired: matched.amount,
      resource,
      description: '',
      mimeType: 'application/json',
      payTo: matched.payTo,
      maxTimeoutSeconds: 600,
      asset: assetAddressFromCaip19(matched.asset),
    };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      paymentRequirements: this.toRequirements(matched, resource),
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
      paymentRequirements: this.toRequirements(matched, resource),
    });
  }
}
