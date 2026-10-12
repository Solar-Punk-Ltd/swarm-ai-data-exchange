/**
 * MCP Tool: get_split_contract
 *
 * Reads the seller's RevenueSplitter clone from the factory's `splitterOf` mapping. Pure RPC —
 * no signer, no transaction, no gas.
 *
 * Returns `splitter: null` when the seller has not deployed one yet. It never returns a
 * speculative address: a clone's address is an ordinary CREATE address that cannot be derived
 * off-chain, and publishing a `payTo` nobody can collect from is worse than reporting nothing.
 */
import { getAddress } from 'viem';
import {
  getErrorMessage,
  getResponseWithStructuredContent,
  getToolErrorResponse,
} from '../../utils';
import type { ToolResponse } from '../../utils';
import { factoryAddress, identityRail, readSplitter, sellerAddress } from '../../splitter';
import { GetSplitContractArgs } from './models';

export async function getSplitContract(args: GetSplitContractArgs): Promise<ToolResponse> {
  let rail: string;
  try {
    rail = args.chainId ?? identityRail();
  } catch (err) {
    return getToolErrorResponse(getErrorMessage(err));
  }
  const factory = factoryAddress(rail);
  if (!factory) {
    return getToolErrorResponse(
      `Splitter is not configured for ${rail}. Set SPLITTER_FACTORY_ADDRESSES.`,
    );
  }

  let seller = sellerAddress();
  if (args.seller) {
    try {
      seller = getAddress(args.seller);
    } catch {
      return getToolErrorResponse(`Invalid seller address: ${args.seller}`);
    }
  }
  if (!seller) {
    return getToolErrorResponse(
      'No seller address. Set AGENT_PAYMENT_ADDRESS or pass the seller argument.',
    );
  }

  try {
    const result = await readSplitter({ factory, seller, chainId: rail });
    return getResponseWithStructuredContent({
      ...result,
      note: result.deployed
        ? undefined
        : 'No split contract for this seller yet. Run register_agent before publishing.',
    });
  } catch (err) {
    return getToolErrorResponse(`Failed to read split contract: ${getErrorMessage(err)}`);
  }
}
