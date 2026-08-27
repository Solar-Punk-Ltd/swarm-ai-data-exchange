/**
 * MCP Tool: create_split_contract
 *
 * Deploys the seller's RevenueSplitter clone — the address that belongs in a listing's
 * `payment[].payTo`. This is the seller's own transaction, signed with PRIVATE_KEY, which is the
 * point: the seller pays for their clone rather than the marketplace operator who would otherwise
 * absorb the cost when sweeping. Idempotent — a seller who already has a clone gets it back with
 * `alreadyExisted: true` and no transaction.
 */
import { getAddress } from 'viem';
import {
  getErrorMessage,
  getResponseWithStructuredContent,
  getToolErrorResponse,
} from '../../utils';
import type { ToolResponse } from '../../utils';
import { createSplitter, factoryAddress, sellerAddress } from '../../splitter';
import { CreateSplitContractArgs } from './models';

export async function createSplitContract(args: CreateSplitContractArgs): Promise<ToolResponse> {
  const factory = factoryAddress();
  if (!factory) {
    return getToolErrorResponse('Splitter is not configured. Set SPLITTER_FACTORY_ADDRESS.');
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
    const result = await createSplitter({ factory, seller });
    return getResponseWithStructuredContent(result);
  } catch (err) {
    return getToolErrorResponse(`Failed to create split contract: ${getErrorMessage(err)}`);
  }
}
