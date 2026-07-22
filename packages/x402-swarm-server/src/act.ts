import { Bee } from '@ethersphere/bee-js';

export interface GrantResult {
  actHistoryRef: string; // new ACT history head
  granteeRef: string; // new grantee-list reference
}

// Step 10: add the consumer's Bee-node public key to the item's ACT grantee list.
// Advances both the ACT history and the grantee-list reference; the new values seed the
// state-feed write at step 11.
export async function grantActAccess(
  bee: Bee,
  postageBatchId: string,
  currentGranteeRef: string,
  currentActHistoryRef: string,
  granteePublicKey: string,
): Promise<GrantResult> {
  const result = await bee.patchGrantees(postageBatchId, currentGranteeRef, currentActHistoryRef, {
    add: [granteePublicKey],
  });
  return {
    actHistoryRef: result.historyref.toString(),
    granteeRef: result.ref.toString(),
  };
}
