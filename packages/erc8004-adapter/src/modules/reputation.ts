import { Contract, ethers, type Signer, type Provider } from 'ethers';
import { REPUTATION_REGISTRY_ABI } from '../abis/ReputationRegistry';
import type { PostFeedbackParams, FeedbackAuth, FeedbackResult, ReputationSummary } from '../types';

const FEEDBACK_AUTH_TYPES = {
  FeedbackAuth: [
    { name: 'agentId', type: 'uint256' },
    { name: 'consumer', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ],
};

export class ReputationModule {
  private contract: Contract;
  private chainId: bigint;

  constructor(address: string, signerOrProvider: Signer | Provider, chainId: bigint) {
    this.contract = new Contract(address, REPUTATION_REGISTRY_ABI, signerOrProvider);
    this.chainId = chainId;
  }

  async postFeedback(params: PostFeedbackParams): Promise<string> {
    if (params.feedbackAuth) {
      const signerAddress = await this.getSignerAddress();
      this.verifyFeedbackAuth(params.feedbackAuth, signerAddress);
    }

    const value = BigInt(Math.round(Math.max(0, Math.min(100, params.score))));
    const feedbackURI = params.evidenceURI ?? '';
    const feedbackHash = feedbackURI
      ? ethers.keccak256(ethers.toUtf8Bytes(feedbackURI))
      : ethers.ZeroHash;

    const tx = await this.contract.giveFeedback(
      params.agentId,
      value,
      0,                       // valueDecimals — score is already 0-100 integer
      params.tags?.[0] ?? '',
      params.tags?.[1] ?? '',
      params.endpoint ?? '',
      feedbackURI,
      feedbackHash,
    );
    const receipt = await tx.wait();
    return receipt.hash as string;
  }

  async revokeFeedback(agentId: bigint, feedbackIndex: bigint): Promise<string> {
    const tx = await this.contract.revokeFeedback(agentId, feedbackIndex);
    const receipt = await tx.wait();
    return receipt.hash as string;
  }

  async getFeedback(
    agentId: bigint,
    clientAddress: string,
    feedbackIndex: bigint,
  ): Promise<FeedbackResult> {
    const [value, valueDecimals, tag1, tag2, isRevoked] = await this.contract.readFeedback(
      agentId,
      clientAddress,
      feedbackIndex,
    ) as [bigint, number, string, string, boolean];

    return {
      value,
      valueDecimals,
      score: this.normalizeScore(value, valueDecimals),
      tag1,
      tag2,
      isRevoked,
    };
  }

  async getSummary(
    agentId: bigint,
    clientAddresses: string[] = [],
    tag1 = '',
    tag2 = '',
  ): Promise<ReputationSummary> {
    const addresses =
      clientAddresses.length > 0
        ? clientAddresses
        : (await this.contract.getClients(agentId) as string[]);

    const [count, summaryValue, summaryDecimals] = await this.contract.getSummary(
      agentId,
      addresses,
      tag1,
      tag2,
    ) as [bigint, bigint, number];

    return {
      count,
      averageScore: count > 0n ? this.normalizeScore(summaryValue / count, summaryDecimals) : 0,
      rawValue: summaryValue,
      rawDecimals: summaryDecimals,
    };
  }

  // Provider calls this to generate a FeedbackAuth token for a specific consumer.
  async signFeedbackAuth(
    agentId: bigint,
    consumerAddress: string,
    ttlSeconds = 3600,
  ): Promise<FeedbackAuth> {
    const signer = this.contract.runner as Signer;
    if (!signer?.signTypedData) throw new Error('Signer required to sign FeedbackAuth');

    const deadline = Math.floor(Date.now() / 1000) + ttlSeconds;
    const signature = await signer.signTypedData(
      this.buildDomain(),
      FEEDBACK_AUTH_TYPES,
      { agentId, consumer: consumerAddress, deadline },
    );

    return { agentId, consumer: consumerAddress, deadline, signature };
  }

  // Verifies a FeedbackAuth token. Returns the recovered signer address (the provider's wallet).
  verifyFeedbackAuth(auth: FeedbackAuth, expectedConsumer?: string): string {
    if (Math.floor(Date.now() / 1000) > auth.deadline) {
      throw new Error('FeedbackAuth expired');
    }
    if (expectedConsumer && auth.consumer.toLowerCase() !== expectedConsumer.toLowerCase()) {
      throw new Error(`FeedbackAuth consumer mismatch: token is for ${auth.consumer}`);
    }

    const recovered = ethers.verifyTypedData(
      this.buildDomain(),
      FEEDBACK_AUTH_TYPES,
      { agentId: auth.agentId, consumer: auth.consumer, deadline: auth.deadline },
      auth.signature,
    );
    return recovered;
  }

  private buildDomain() {
    return {
      name: 'ERC8004FeedbackAuth',
      version: '1',
      chainId: this.chainId,
      verifyingContract: this.contract.target as string,
    };
  }

  private normalizeScore(value: bigint, decimals: number): number {
    const divisor = BigInt(10 ** decimals);
    return Math.max(0, Math.min(100, Number(value / divisor)));
  }

  private async getSignerAddress(): Promise<string> {
    const signer = this.contract.runner as Signer | null;
    return (await signer?.getAddress?.()) ?? ethers.ZeroAddress;
  }
}
