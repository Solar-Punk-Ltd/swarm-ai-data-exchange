/**
 * MCP Tool: register_agent
 *
 * Idempotent, convergent seller-agent onboarding. Replaces `create_agent` and
 * `create_split_contract`, and is safe to call on every agent startup: it converges on the
 * correct state rather than creating anything unconditionally.
 *
 * Three steps with deliberately different failure semantics, which is why the result reports
 * each separately rather than collapsing to one success flag:
 *
 *   identity — fatal. Without an agentId there is nothing to sell under.
 *   splitter — reported. `unconfigured` is legitimate for identity-only deployments.
 *   link     — never fatal. It is a discovery index; an unattributed agent can still sell.
 *
 * The controlling invariant: **once an agentId exists in this process, this tool never
 * returns an error response.** A text-only error would discard the one piece of state the
 * caller just paid gas for — the exact bug that made the old `create_agent` dangerous.
 */
import { getAddress } from 'viem';
import {
  AGENT_SPLITTER,
  SWARM_AGENT_ID,
  getAgentSplitter,
  setAgentSplitter,
} from '@solarpunk/erc8004-adapter';
import type { AgentCard } from '@solarpunk/erc8004-adapter';
import config from '../../config';
import {
  getErrorMessage,
  getResponseWithStructuredContent,
  getToolErrorResponse,
  ToolResponse,
  withTimeout,
} from '../../utils';
import {
  buildAgentCard,
  cardsEqual,
  discoverCandidates,
  ensureAgentIdMetadata,
  hasAgentIdMetadata,
  identityContext,
  mintAgent,
  publishAgentCard,
  registrationEntry,
  writeClient,
} from '../../agent-identity';
import type { Candidate, IdentityContext } from '../../agent-identity';
import { createSplitter, factoryAddress, readSplitter, sellerAddress } from '../../splitter';
import {
  RegisterAgentArgs,
  RegisterAgentIdentity,
  RegisterAgentLink,
  RegisterAgentResult,
  RegisterAgentSplitter,
} from './models';
import { RPC_TIMEOUT_MS, TX_TIMEOUT_MS } from '../../constants';

function pickCandidate(candidates: Candidate[], verdict: Candidate['verdict']): Candidate | null {
  const matching = candidates.filter((c) => c.verdict === verdict);

  if (matching.length === 0) {
    return null;
  }

  return matching.reduce((lowest, c) => (BigInt(c.agentId) < BigInt(lowest.agentId) ? c : lowest));
}

export async function registerAgent(args: RegisterAgentArgs): Promise<ToolResponse> {
  const dryRun = args.dryRun ?? false;
  const refreshCard = args.refreshCard ?? true;
  const warnings: string[] = [];

  // ── A. Context ────────────────────────────────────────────────────────────
  // Nothing has happened yet, so a missing key is safe to fail hard on.
  let ctx: IdentityContext;
  try {
    ctx = identityContext(args.catalogFeedOwner);
  } catch (err) {
    return getToolErrorResponse(getErrorMessage(err));
  }

  const erc8004 = writeClient(ctx);
  const desiredCard = buildAgentCard({
    name: args.name,
    description: args.description,
    image: args.image,
    version: args.version,
    x402: args.x402,
    capabilities: args.capabilities,
    catalogFeedOwner: ctx.feedOwner,
  });

  const identity: RegisterAgentIdentity = {
    status: 'failed',
    agentId: null,
    agentURI: ctx.agentURI,
    verified: false,
    metadataStatus: 'missing',
    candidatesScanned: 0,
    candidates: [],
  };

  // ── B. Discovery ──────────────────────────────────────────────────────────
  let existingCard: AgentCard | null = null;
  try {
    const discovery = await discoverCandidates(erc8004, ctx, args.fromBlock);
    identity.candidates = discovery.candidates;
    identity.candidatesScanned = discovery.candidates.length;
    existingCard = discovery.card;

    // Distinguish "found nothing" from "could not look". Minting on the latter would spend
    // gas on a duplicate because an RPC blipped.
    const lookupFailed = [discovery.cardError, discovery.scanError].filter(Boolean);
    if (discovery.candidates.every((c) => c.verdict === 'rejected') && lookupFailed.length > 0) {
      identity.discoveryError = lookupFailed.join('; ');
      identity.error =
        'Discovery failed, so minting was suppressed to avoid creating a duplicate agent. ' +
        'Resolve the transport error and retry.';
      return getToolErrorResponse(
        `register_agent: ${identity.error} Details: ${identity.discoveryError}`,
      );
    }
    if (discovery.cardError) warnings.push(`Agent Card lookup degraded: ${discovery.cardError}`);
    if (discovery.scanError) warnings.push(`MetadataSet scan degraded: ${discovery.scanError}`);
  } catch (err) {
    return getToolErrorResponse(`register_agent: discovery failed: ${getErrorMessage(err)}`);
  }

  const verified = pickCandidate(identity.candidates, 'verified');
  const repairable = pickCandidate(identity.candidates, 'repairable');
  const ownedByOther = identity.candidates.find(
    (c) => c.verdict === 'rejected' && c.reason?.startsWith('owned by'),
  );

  if (identity.candidates.filter((c) => c.verdict !== 'rejected').length > 1) {
    warnings.push(
      `${identity.candidates.length} agents resolve to this feed owner — a prior double-mint. ` +
        'Using the lowest agentId.',
    );
  }

  // ── C. Converge on an identity ────────────────────────────────────────────
  let agentId: bigint | null = null;

  if (verified) {
    agentId = BigInt(verified.agentId);
    identity.agentId = verified.agentId;
    identity.verified = true;
    identity.status = 'existing';

    // Card content drift (name/description/capabilities/x402 changed between releases).
    if (refreshCard && existingCard) {
      const withRegistrations: AgentCard = {
        ...desiredCard,
        registrations: [registrationEntry(erc8004, agentId)],
      };
      if (!cardsEqual(withRegistrations, existingCard)) {
        if (dryRun) {
          identity.status = 'would-refresh';
        } else {
          try {
            identity.cardReference = await publishAgentCard(
              ctx,
              withRegistrations,
              args.postageBatchId,
            );
            identity.status = 'refreshed';
          } catch (err) {
            // Non-fatal: the agent is registered and sellable, the card is just stale.
            warnings.push(`Agent Card refresh failed: ${getErrorMessage(err)}`);
          }
        }
      }
    }
  } else if (repairable) {
    agentId = BigInt(repairable.agentId);
    identity.agentId = repairable.agentId;
    if (dryRun) {
      identity.status = 'would-repair';
    } else {
      const repaired: AgentCard = {
        ...desiredCard,
        registrations: [registrationEntry(erc8004, agentId)],
      };
      try {
        identity.cardReference = await publishAgentCard(ctx, repaired, args.postageBatchId);
        identity.status = 'repaired';
        identity.verified = true;
      } catch (err) {
        identity.status = 'incomplete';
        identity.error =
          `Agent ${identity.agentId} is ours but its Agent Card could not be rewritten: ` +
          `${getErrorMessage(err)}. Re-run register_agent once Swarm is reachable.`;
        warnings.push(identity.error);
      }
    }
  } else if (ownedByOther) {
    // Never mint past this. A second NFT for the same feed is unrecoverable; an error is not.
    return getToolErrorResponse(
      `register_agent: agent ${ownedByOther.agentId} already points at this feed owner ` +
        `(${ctx.feedOwner}) but is owned by ${ownedByOther.owner}, not the PRIVATE_KEY signer ` +
        `${ctx.signer}. Minting a second agent would orphan the first. Use the owning key, or ` +
        'transfer the NFT.',
    );
  } else if (dryRun) {
    identity.status = 'would-mint';
  } else {
    // ── Mint. Three independent try blocks: the tokenURI must exist before the mint, and a
    // failure in the post-mint card write must never discard the agentId we just paid for.
    try {
      identity.cardReference = await publishAgentCard(ctx, desiredCard, args.postageBatchId);
    } catch (err) {
      return getToolErrorResponse(
        `register_agent: failed to upload the Agent Card to Swarm: ${getErrorMessage(err)}. ` +
          'No NFT was minted.',
      );
    }

    let txHash: string;
    try {
      const minted = await mintAgent(erc8004, ctx);
      agentId = minted.agentId;
      txHash = minted.txHash;
    } catch (err) {
      return getToolErrorResponse(
        `register_agent: the ERC-8004 mint failed: ${getErrorMessage(err)}. No NFT was minted.`,
      );
    }

    // An agentId now exists. From here nothing may return an error response.
    identity.agentId = agentId.toString();
    identity.txHash = txHash;
    identity.metadataStatus = 'present'; // written atomically in register()

    try {
      const patched: AgentCard = {
        ...desiredCard,
        registrations: [registrationEntry(erc8004, agentId)],
      };
      identity.cardReference = await publishAgentCard(ctx, patched, args.postageBatchId);
      identity.status = 'minted';
      identity.verified = true;
    } catch (err) {
      identity.status = 'incomplete';
      identity.error =
        `Minted agent ${identity.agentId} (tx ${txHash}) but the Agent Card write failed: ` +
        `${getErrorMessage(err)}. Re-run register_agent — the next call will repair the card ` +
        'rather than mint again.';
      warnings.push(identity.error);
    }
  }

  // ── D. Backfill swarm_agent_id ────────────────────────────────────────────
  // Agents minted without it are invisible to the fallback scan forever.
  if (agentId !== null && identity.metadataStatus !== 'present') {
    try {
      if (dryRun) {
        // The read is free; only the write is suppressed. Reporting would-backfill without
        // looking would make every dry run claim work that may not be needed.
        identity.metadataStatus = (await hasAgentIdMetadata(erc8004, ctx, agentId))
          ? 'present'
          : 'would-backfill';
      } else {
        identity.metadataStatus = await ensureAgentIdMetadata(erc8004, ctx, agentId);
      }
    } catch (err) {
      identity.metadataStatus = 'failed';
      warnings.push(`Could not resolve ${SWARM_AGENT_ID} metadata: ${getErrorMessage(err)}`);
    }
  }

  // ── E. Splitter ───────────────────────────────────────────────────────────
  const splitter: RegisterAgentSplitter = {
    status: 'unconfigured',
    address: null,
    seller: null,
    factory: null,
  };

  const factory = factoryAddress();
  let resolvedSeller: string | null = null;
  try {
    resolvedSeller = args.seller
      ? getAddress(args.seller)
      : (sellerAddress() ?? getAddress(ctx.signer));
  } catch {
    warnings.push(`Invalid seller address: ${args.seller}`);
  }

  if (args.skipSplitter) {
    splitter.status = 'skipped';
  } else if (!factory || !resolvedSeller) {
    splitter.status = 'unconfigured';
    warnings.push(
      'SPLITTER_FACTORY_ADDRESS is unset, so no revenue splitter was resolved. Listings will ' +
        'have to name a payTo explicitly, and such sales are untaxed and earn no ' +
        'Proof-of-Purchase.',
    );
  } else {
    splitter.seller = resolvedSeller;
    splitter.factory = factory;
    const splitterCtx = { factory, seller: resolvedSeller as `0x${string}` };
    try {
      if (dryRun) {
        const read = await readSplitter(splitterCtx);
        splitter.address = read.splitter;
        splitter.treasury = read.treasury;
        splitter.taxBps = read.taxBps;
        splitter.status = read.deployed ? 'existing' : 'would-deploy';
      } else {
        const ensured = await createSplitter(splitterCtx);
        splitter.address = ensured.splitter;
        splitter.treasury = ensured.treasury;
        splitter.taxBps = ensured.taxBps;
        splitter.txHash = ensured.txHash;
        splitter.status = ensured.alreadyExisted ? 'existing' : 'deployed';
      }
    } catch (err) {
      splitter.status = 'failed';
      splitter.error = getErrorMessage(err);
      warnings.push(`Splitter resolution failed: ${splitter.error}`);
    }
  }

  // ── F. Link — always non-fatal ────────────────────────────────────────────
  const link: RegisterAgentLink = {
    status: 'skipped',
    metadataKey: AGENT_SPLITTER,
    splitter: splitter.address,
  };

  if (agentId === null || !splitter.address) {
    link.status = 'skipped';
    link.reason = agentId === null ? 'no agentId to bind' : 'no splitter address to bind';
  } else {
    try {
      const existing = await withTimeout(
        getAgentSplitter(erc8004.identity, agentId),
        RPC_TIMEOUT_MS,
        `RPC getMetadata(${agentId}, ${AGENT_SPLITTER})`,
      );
      if (existing && getAddress(existing) === getAddress(splitter.address)) {
        link.status = 'already-linked';
      } else if (dryRun) {
        link.status = 'would-link';
        if (existing) link.previousSplitter = existing;
      } else {
        link.txHash = await withTimeout(
          setAgentSplitter(erc8004.identity, agentId, splitter.address),
          TX_TIMEOUT_MS,
          `setMetadata(${AGENT_SPLITTER})`,
        );
        link.status = existing ? 'repointed' : 'linked';
        if (existing) link.previousSplitter = existing;
      }
    } catch (err) {
      // Never fatal: the link is a discovery index, not a precondition for selling.
      link.status = 'failed';
      link.error = getErrorMessage(err);
      warnings.push(
        `Splitter link failed: ${link.error}. The agent can still sell, but indexers cannot ` +
          'attribute its sales.',
      );
    }
  }

  const result: RegisterAgentResult = {
    feedOwner: ctx.feedOwner,
    signer: ctx.signer,
    chain: config.chain.chain,
    dryRun,
    identity,
    splitter,
    link,
    warnings,
    message:
      `${dryRun ? '[dry run] ' : ''}identity ${identity.status}` +
      `${identity.agentId ? ` (agent ${identity.agentId})` : ''}, ` +
      `splitter ${splitter.status}, link ${link.status}.`,
  };

  return getResponseWithStructuredContent(result);
}
