import { Contract, type Signer, type Provider, type Log } from 'ethers';
import { IDENTITY_REGISTRY_ABI } from '../abis/IdentityRegistry';
import type { RegisterResult, WalletAuth } from '../types';

const WALLET_AUTH_TYPES = {
  WalletAuth: [
    { name: 'agentId', type: 'uint256' },
    { name: 'wallet', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ],
};

export class IdentityModule {
  private contract: Contract;
  private chainId: bigint;

  constructor(address: string, signerOrProvider: Signer | Provider, chainId: bigint) {
    this.contract = new Contract(address, IDENTITY_REGISTRY_ABI, signerOrProvider);
    this.chainId = chainId;
  }

  async register(agentURI: string): Promise<RegisterResult> {
    const tx = await this.contract['register(string)'](agentURI);
    const receipt = await tx.wait();

    const event = (receipt.logs as Log[])
      .map((log) => {
        try {
          return this.contract.interface.parseLog(log);
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
