/**
 * MCP Tool: ensure_split_contract
 *
 * Resolves the seller's RevenueSplitter clone — the address that belongs in a listing's
 * `payment[].payTo`. Read-only by default: the clone address is CREATE2-deterministic, so it can
 * be published before any transaction is sent, and an x402 settlement (ERC-3009) credits it
 * whether or not code is deployed there yet. Pass `deploy: true` to actually create the clone,
 * which is only required before the first `distribute` call.
 */
import { getAddress } from 'viem';
import {
  getErrorMessage,
  getResponseWithStructuredContent,
  getToolErrorResponse,
} from '../../utils';
import type { ToolResponse } from '../../utils';
import { factoryAddress, resolveSplitter, sellerAddress } from '../../splitter';
import { EnsureSplitContractArgs } from './models';

export async function ensureSplitContract(args: EnsureSplitContractArgs): Promise<ToolResponse> {
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
      'No seller address. Set SELLER_ADDRESS or pass the seller argument.',
    );
  }

  try {
    const result = await resolveSplitter({ factory, seller }, args.deploy ?? false);
    return getResponseWithStructuredContent(result);
  } catch (err) {
    return getToolErrorResponse(`Failed to resolve split contract: ${getErrorMessage(err)}`);
  }
}
