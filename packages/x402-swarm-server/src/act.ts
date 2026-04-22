import { bee } from './bee';
import { fetchCatalogue, findDataItem } from './catalogue';
import type { ActGrantResult } from './types';

const POSTAGE_BATCH_ID = process.env.POSTAGE_BATCH_ID ?? '';
const PUBLISHER_PUBLIC_KEY = process.env.PUBLISHER_PUBLIC_KEY ?? '';

export async function grantActAccess(
  swarmHash: string,
  buyerPublicKey: string,
): Promise<ActGrantResult> {
  const catalogue = await fetchCatalogue();
  const item = findDataItem(catalogue, swarmHash);

  const result = await bee.patchGrantees(POSTAGE_BATCH_ID, item.granteeRef, item.actHistoryRef, {
    add: [buyerPublicKey],
  });

  return {
    swarmHash,
    actHistoryAddress: result.historyref.toString(),
    granteeRef: result.ref.toString(),
    publisherPublickey: PUBLISHER_PUBLIC_KEY,
  };
}
