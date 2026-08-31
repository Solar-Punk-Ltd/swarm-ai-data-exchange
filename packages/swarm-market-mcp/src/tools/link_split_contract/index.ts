/**
 * MCP Tool: link_split_contract
 *
 * Binds an ERC-8004 agent to its RevenueSplitter clone by writing the clone address into the
 * Identity Registry under the AGENT_SPLITTER metadata key.
 *
 * The link lives in the registry rather than in the clone deliberately. `createSplitter` is
 * permissionless, so an agentId held by the factory would be a claim anyone could make about
 * anyone; the registry already gates `setMetadata` on NFT ownership. And clone terms are frozen at
 * `initialize` while agent NFT ownership can transfer, so a binding baked into the clone would
 * eventually be wrong with no way to correct it. Re-running this tool re-points the link.
 *
 * Because `MetadataSet` indexes the metadata key, this write is also what makes the reverse
 * direction (splitter -> agent) a single log query for indexers and dashboards.
 *
 * Sends a transaction, so PRIVATE_KEY is required and must own the agent NFT.
 */
import { ethers } from 'ethers';
import { getAddress } from 'viem';
import {
  AGENT_SPLITTER,
  createERC8004Client,
  getAgentSplitter,
  setAgentSplitter,
} from '@solarpunk/erc8004-adapter';
import config from '../../config';
import {
  getErrorMessage,
  getResponseWithStructuredContent,
  getToolErrorResponse,
} from '../../utils';
import type { ToolResponse } from '../../utils';
import { factoryAddress, readSplitter, sellerAddress } from '../../splitter';
import { LinkSplitContractArgs } from './models';

export async function linkSplitContract(args: LinkSplitContractArgs): Promise<ToolResponse> {
  let agentId: bigint;
  try {
    agentId = BigInt(args.agentId);
  } catch {
    return getToolErrorResponse(`Invalid agentId: ${args.agentId}`);
  }

  const privateKey = config.chain.walletPrivateKey;
  if (!privateKey) {
    return getToolErrorResponse(
      'Missing PRIVATE_KEY — required to write agent metadata. The signer must own the agent NFT.',
    );
  }

  // Resolve which splitter to link: an explicit address, or the seller's clone from the factory.
  let splitter: string;
  let seller: string | undefined;
  let factory: string | undefined;

  if (args.splitter) {
    try {
      splitter = getAddress(args.splitter);
    } catch {
      return getToolErrorResponse(`Invalid splitter address: ${args.splitter}`);
    }
  } else {
    factory = factoryAddress();
    if (!factory) {
      return getToolErrorResponse(
        'No splitter given and SPLITTER_FACTORY_ADDRESS is unset. Pass splitter explicitly.',
      );
    }

    seller = sellerAddress();
    if (args.seller) {
      try {
        seller = getAddress(args.seller);
      } catch {
        return getToolErrorResponse(`Invalid seller address: ${args.seller}`);
      }
    }
    if (!seller) {
      return getToolErrorResponse(
        'No seller address. Set AGENT_PAYMENT_ADDRESS, or pass seller or splitter.',
      );
    }

    try {
      const resolved = await readSplitter({
        factory: factory as `0x${string}`,
        seller: seller as `0x${string}`,
      });
      if (!resolved.splitter) {
        return getToolErrorResponse(
          `Seller ${seller} has no split contract on factory ${factory}. ` +
            'Run create_split_contract first — there is no address to link yet.',
        );
      }
      splitter = resolved.splitter;
    } catch (err) {
      return getToolErrorResponse(`Failed to resolve split contract: ${getErrorMessage(err)}`);
    }
  }

  try {
    const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
    const signerWallet = new ethers.Wallet(privateKey, provider);
    const erc8004 = createERC8004Client({
      provider,
      signer: signerWallet,
      chain: config.chain.chain,
    });

    // Fail before spending gas if the signer cannot write: the registry gates setMetadata on
    // ownership, and a revert here is far less legible than this message.
    const owner = await erc8004.identity.getOwner(agentId);
    if (getAddress(owner) !== getAddress(signerWallet.address)) {
      return getToolErrorResponse(
        `Signer ${signerWallet.address} does not own agent ${agentId} (owner is ${owner}). ` +
          'Only the agent owner can link a split contract.',
      );
    }

    const existing = await getAgentSplitter(erc8004.identity, agentId);
    if (existing && getAddress(existing) === getAddress(splitter)) {
      return getResponseWithStructuredContent({
        agentId: agentId.toString(),
        splitter,
        seller,
        factory,
        txHash: '',
        metadataKey: AGENT_SPLITTER,
        alreadyLinked: true,
        note: 'Agent already points at this splitter. No transaction sent.',
      });
    }

    const txHash = await setAgentSplitter(erc8004.identity, agentId, splitter);

    return getResponseWithStructuredContent({
      agentId: agentId.toString(),
      splitter,
      seller,
      factory,
      txHash,
      metadataKey: AGENT_SPLITTER,
      alreadyLinked: false,
      note: existing
        ? `Re-pointed from ${existing}. Indexers will pick up the latest MetadataSet event.`
        : undefined,
    });
  } catch (err) {
    return getToolErrorResponse(`Failed to link split contract: ${getErrorMessage(err)}`);
  }
}
