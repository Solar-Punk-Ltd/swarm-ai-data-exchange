import { Contract, getBytes, type Signer, type Provider, type Log, type EventLog } from 'ethers';
import { IDENTITY_REGISTRY_ABI } from '../abis/IdentityRegistry';
import type { RegisterResult, WalletAuth, MetadataEntry } from '../types';

const WALLET_AUTH_TYPES = {
  WalletAuth: [
    { name: 'agentId', type: 'uint256' },
    { name: 'wallet', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ],
};

export class IdentityModule {
  private contract: Contract;
  private provider: Provider;
  private chainId: bigint;
  private deployBlock: number;

  constructor(
    address: string,
    signerOrProvider: Signer | Provider,
    chainId: bigint,
    deployBlock = 0,
  ) {
    this.contract = new Contract(address, IDENTITY_REGISTRY_ABI, signerOrProvider);
    this.provider =
      'provider' in signerOrProvider && signerOrProvider.provider
        ? signerOrProvider.provider
        : (signerOrProvider as Provider);
    this.chainId = chainId;
    this.deployBlock = deployBlock;
  }

  get contractAddress(): string {
    return this.contract.target as string;
  }

  get networkChainId(): bigint {
    return this.chainId;
  }

  async register(agentURI?: string, metadata?: MetadataEntry[]): Promise<RegisterResult> {
    let tx;
    try {
      if (agentURI !== undefined) {
        if (metadata && metadata.length > 0) {
          tx = await this.contract.getFunction('register(string,tuple(string,bytes)[])')(
            agentURI,
            metadata,
          );
        } else {
          tx = await this.contract.getFunction('register(string)')(agentURI);
        }
      } else {
        tx = await this.contract.getFunction('register()')();
      }
    } catch {
      // estimateGas failed — simulate via eth_call to surface the real revert reason.
      // Some RPC endpoints (e.g. Base Sepolia public node) return a misleading
      // "intrinsic gas too high" error instead of the actual contract revert.
      if (agentURI !== undefined) {
        if (metadata && metadata.length > 0) {
          await this.contract
            .getFunction('register(string,tuple(string,bytes)[])')
            .staticCall(agentURI, metadata);
        } else {
          await this.contract.getFunction('register(string)').staticCall(agentURI);
        }
      } else {
        await this.contract.getFunction('register()').staticCall();
      }
      // staticCall succeeded → only estimateGas is broken; retry with explicit gasLimit.
      const overrides = { gasLimit: 500_000 };
      if (agentURI !== undefined) {
        if (metadata && metadata.length > 0) {
          tx = await this.contract.getFunction('register(string,tuple(string,bytes)[])')(
            agentURI,
            metadata,
            overrides,
          );
        } else {
          tx = await this.contract.getFunction('register(string)')(agentURI, overrides);
        }
      } else {
        tx = await this.contract.getFunction('register()')(overrides);
      }
    }
    const receipt = await tx.wait();

    const event = (receipt.logs as Log[])
      .map((log) => {
        try {
          return this.contract.interface.parseLog({ topics: [...log.topics], data: log.data });
        } catch {
          return null;
        }
      })
      .find((e) => e?.name === 'Registered');

    if (!event) throw new Error('Registered event not found in transaction receipt');

    return { agentId: event.args.agentId as bigint, txHash: receipt.hash as string };
  }

  async setAgentURI(agentId: bigint, newURI: string): Promise<string> {
    const tx = await this.contract.setAgentURI(agentId, newURI);
    const receipt = await tx.wait();
    return receipt.hash as string;
  }

  async getAgentURI(agentId: bigint): Promise<string> {
    return this.contract.tokenURI(agentId) as Promise<string>;
  }

  async getOwner(agentId: bigint): Promise<string> {
    return this.contract.ownerOf(agentId) as Promise<string>;
  }

  async setAgentWallet(
    agentId: bigint,
    newWallet: string,
    deadline: number,
    signature: string,
  ): Promise<string> {
    const tx = await this.contract.setAgentWallet(agentId, newWallet, deadline, signature);
    const receipt = await tx.wait();
    return receipt.hash as string;
  }

  async getAgentWallet(agentId: bigint): Promise<string> {
    return this.contract.getAgentWallet(agentId) as Promise<string>;
  }

  async unsetAgentWallet(agentId: bigint): Promise<string> {
    const tx = await this.contract.unsetAgentWallet(agentId);
    const receipt = await tx.wait();
    return receipt.hash as string;
  }

  private async queryFilterChunked(
    filter: ReturnType<Contract['filters'][string]>,
    fromBlock: number,
    toBlock: number,
    chunkSize = 9_999,
  ): Promise<(Log | EventLog)[]> {
    const results: (Log | EventLog)[] = [];

    for (let start = fromBlock; start <= toBlock; start += chunkSize) {
      const end = Math.min(start + chunkSize - 1, toBlock);
      const logs = await this.contract.queryFilter(filter, start, end);
      results.push(...logs);
    }
    return results;
  }

  async getRegisteredAgents(
    fromBlock: number | 'earliest' = 'earliest',
    toBlock?: number,
  ): Promise<{ agentId: bigint; agentURI: string; owner: string }[]> {
    const latest = await this.provider.getBlockNumber();
    const from = fromBlock === 'earliest' ? this.deployBlock : fromBlock;
    const to = toBlock ?? latest;

    const filter = this.contract.filters.Registered();
    const logs = await this.queryFilterChunked(filter, from, to);

    return logs.map((log) => {
      const parsedLog = this.contract.interface.parseLog({
        topics: [...(log as EventLog | Log).topics],
        data: (log as EventLog | Log).data,
      });
      return {
        agentId: parsedLog?.args.agentId as bigint,
        agentURI: parsedLog?.args.agentURI as string,
        owner: parsedLog?.args.owner as string,
      };
    });
  }

  async getAgentsByMetadata(
    metadataKey: string,
    fromBlock: number | 'earliest' = 'earliest',
    toBlock?: number,
  ): Promise<{ agentId: bigint; rawValue: Uint8Array }[]> {
    const latest = await this.provider.getBlockNumber();
    const from = fromBlock === 'earliest' ? this.deployBlock : fromBlock;
    const to = toBlock ?? latest;

    const filter = this.contract.filters.MetadataSet(null, metadataKey);

    const logs = await this.queryFilterChunked(filter, from, to);

    return logs.map((log) => {
      const parsedLog = this.contract.interface.parseLog({
        topics: [...(log as EventLog | Log).topics],
        data: (log as EventLog | Log).data,
      });
      return {
        agentId: parsedLog?.args.agentId as bigint,
        rawValue: getBytes(parsedLog?.args.metadataValue as string),
      };
    });
  }

  async findAgentsWithMetadata(
    metadataKey: string,
    fromBlock?: number,
    toBlock?: number,
  ): Promise<{ agentId: bigint; uri: string; rawValue: Uint8Array }[]> {
    const entries = await this.getAgentsByMetadata(metadataKey, fromBlock, toBlock);

    // Deduplicate: if a key was set multiple times for the same agent, keep the latest event
    const latestByAgent = new Map<bigint, { agentId: bigint; rawValue: Uint8Array }>();
    for (const entry of entries) {
      latestByAgent.set(entry.agentId, entry);
    }

    return Promise.all(
      [...latestByAgent.values()].map(async ({ agentId, rawValue }) => ({
        agentId,
        uri: await this.getAgentURI(agentId),
        rawValue,
      })),
    );
  }

  async setMetadata(agentId: bigint, key: string, value: Uint8Array): Promise<string> {
    const tx = await this.contract.setMetadata(agentId, key, value);
    const receipt = await tx.wait();
    return receipt.hash as string;
  }

  async getMetadata(agentId: bigint, key: string): Promise<Uint8Array> {
    return this.contract.getMetadata(agentId, key) as Promise<Uint8Array>;
  }

  /**
   * Signs an EIP-712 WalletAuth token from the new wallet, authorizing it to be
   * registered as the agent wallet for `agentId`. Pass the returned `WalletAuth`
   * to `setAgentWallet`.
   *
   * @param agentId   The agent's NFT token ID.
   * @param newWallet Signer representing the new hot wallet (must differ from the NFT owner).
   * @param ttlSeconds Token validity in seconds (default 1 hour).
   */
  async signAgentWalletAuth(
    agentId: bigint,
    newWallet: Signer,
    ttlSeconds = 3600,
  ): Promise<WalletAuth> {
    if (!newWallet.signTypedData) throw new Error('Signer required to sign WalletAuth');

    const walletAddress = await newWallet.getAddress();
    const deadline = Math.floor(Date.now() / 1000) + ttlSeconds;

    const signature = await newWallet.signTypedData(this.buildDomain(), WALLET_AUTH_TYPES, {
      agentId,
      wallet: walletAddress,
      deadline,
    });

    return { agentId, wallet: walletAddress, deadline, signature };
  }

  private buildDomain() {
    return {
      name: 'ERC8004WalletAuth',
      version: '1',
      chainId: this.chainId,
      verifyingContract: this.contract.target as string,
    };
  }
}
