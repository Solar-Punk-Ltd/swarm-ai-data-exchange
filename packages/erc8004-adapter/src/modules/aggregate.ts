import type { ReputationModule } from './reputation';
import type { ReputationScore } from '../types';

export class AggregateModule {
  constructor(private reputation: ReputationModule) {}

  async calculateReputation(agentId: bigint): Promise<ReputationScore> {
    const summary = await this.reputation.getSummary(agentId);
    return {
      agentId,
      score: summary.averageScore,
      feedbackCount: summary.count,
      reliable: summary.averageScore >= 70 && summary.count >= 3n,
    };
  }
}
