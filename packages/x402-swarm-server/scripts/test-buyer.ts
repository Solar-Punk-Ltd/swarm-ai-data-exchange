import 'dotenv/config';
import {
  x402Client,
  wrapFetchWithPayment,
  x402HTTPClient,
  type PaymentRequirements,
} from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { secp256k1 } from '@noble/curves/secp256k1';

async function main() {
  let privateKey = process.env.EVM_PRIVATE_KEY;
  if (!privateKey) {
    console.error('EVM_PRIVATE_KEY environment variable is required');
    process.exit(1);
  }
  if (!privateKey.startsWith('0x')) {
    privateKey = `0x${privateKey}`;
  }

  const swarmHash =
    process.env.SWARM_HASH || '8564bb7df58c17e3396f7ceb3874168ed7b2461a56f0954ed3ebc8c7986397b5';
  const baseUrl = process.env.SERVER_URL || 'http://localhost:3000';
  const targetUrl = `${baseUrl}/swarm/data/${swarmHash}`;

  console.log(`Target: ${targetUrl}`);

  const signer = privateKeyToAccount(privateKey as `0x${string}`);
  console.log(`Wallet: ${signer.address}`);

  // Derive compressed secp256k1 public key from private key bytes
  const privKeyBytes = Buffer.from(privateKey.slice(2), 'hex');
  const compressedPublicKey = Buffer.from(secp256k1.getPublicKey(privKeyBytes, true)).toString(
    'hex',
  );
  console.log(`Public key (swarm-public-key): ${compressedPublicKey}`);

  const client = new x402Client();

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(),
  });

  registerExactEvmScheme(client, { signer });

  // Resolve EIP-712 domain metadata (name, version) from the token contract
  // if the server doesn't include it in the 402 requirements.
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
        console.log(`EIP-712 domain resolved: name="${name}", version="${version}"`);
        req.extra = { ...req.extra, name, version };
        req.domain = { ...req.domain, name, version };
      } catch (err) {
        console.error('Failed to resolve EIP-712 domain metadata:', err);
      }
    }
  });

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  console.log('Sending request...');
  try {
    const response = await fetchWithPayment(targetUrl, {
      method: 'GET',
      headers: {
        'swarm-public-key': compressedPublicKey,
      },
    });

    console.log(`Status: ${response.status} ${response.statusText}`);
    const body = await response.text();
    console.log('Response:', body);

    if (response.status === 200) {
      const httpClient = new x402HTTPClient(client);
      try {
        const receipt = httpClient.getPaymentSettleResponse((name) => response.headers.get(name));
        console.log('Payment settled:', JSON.stringify(receipt, null, 2));
      } catch {
        console.log('Request succeeded (no settlement receipt header)');
      }
    } else if (response.status === 402) {
      console.log('Payment verification failed — check wallet USDC balance and facilitator config');
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error('Request failed:', error.message);
    } else {
      console.error('Unknown error:', error);
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
