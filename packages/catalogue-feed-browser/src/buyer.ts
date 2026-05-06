import { x402Client, wrapFetchWithPayment, type PaymentRequirements } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import type { ActGrantResult } from './types.js';

const nameAbi = [
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const;
const versionAbi = [
  {
    name: 'version',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const;

type ExtendedRequirements = PaymentRequirements & { domain?: Record<string, unknown> };

async function getBeePublicKey(beeUrl: string): Promise<string> {
  const res = await fetch(`${beeUrl}/addresses`);
  if (!res.ok) throw new Error(`Failed to fetch Bee addresses (${res.status})`);
  const data = (await res.json()) as { publicKey: string };
  if (!data.publicKey) throw new Error('Bee /addresses response missing publicKey');
  return data.publicKey;
}

export async function executeBuy(
  swarmHash: string,
  serverUrl: string,
  beeUrl: string,
  providedPublicKey?: string,
): Promise<ActGrantResult & { beePublicKey: string }> {
  let privateKey = process.env.EVM_PRIVATE_KEY;
  if (!privateKey) throw new Error('EVM_PRIVATE_KEY environment variable is required');
  if (!privateKey.startsWith('0x')) privateKey = `0x${privateKey}`;

  const signer = privateKeyToAccount(privateKey as `0x${string}`);
  const compressedPublicKey = providedPublicKey ?? (await getBeePublicKey(beeUrl));
  console.log(`[buy] Using public key: ${compressedPublicKey}`);

  const client = new x402Client();
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });

  registerExactEvmScheme(client, { signer });

  client.onBeforePaymentCreation(async (context) => {
    const req = context.selectedRequirements as ExtendedRequirements;
    if (req.network?.startsWith('eip155:') && (!req.extra?.name || !req.extra?.version)) {
      try {
        const [name, version] = await Promise.all([
          publicClient.readContract({
            address: req.asset as Address,
            abi: nameAbi,
            functionName: 'name',
          }),
          publicClient.readContract({
            address: req.asset as Address,
            abi: versionAbi,
            functionName: 'version',
          }),
        ]);
        req.extra = { ...req.extra, name, version };
        req.domain = { ...req.domain, name, version };
      } catch {
        // non-fatal: proceed without EIP-712 domain metadata
      }
    }
  });

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  const targetUrl = `${serverUrl}/swarm/data/${swarmHash}`;

  const response = await fetchWithPayment(targetUrl, {
    method: 'GET',
    headers: { 'swarm-public-key': compressedPublicKey },
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Buy failed (${response.status}): ${body}`);
  }

  return { ...(JSON.parse(body) as ActGrantResult), beePublicKey: compressedPublicKey };
}
