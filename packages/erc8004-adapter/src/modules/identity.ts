import { Contract, type Signer, type Provider, type Log } from 'ethers';
import { IDENTITY_REGISTRY_ABI } from '../abis/IdentityRegistry';
import type { RegisterResult } from '../types';

export class IdentityModule {
  private contract: Contract;

  constructor(address: string, signerOrProvider: Signer | Provider) {
    this.contract = new Contract(address, IDENTITY_REGISTRY_ABI, signerOrProvider);
  }

  async register(agentURI: string): Promise<RegisterResult> {
    const tx = await this.contract['register(string)'](agentURI);
    const receipt = await tx.wait();

    const event = (receipt.logs as Log[])
      .map((log) => { try { return this.contract.interface.parseLog(log); } catch { return null; } })
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
}
