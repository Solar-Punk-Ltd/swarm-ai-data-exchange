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
 * ## Several chains, one Agent Card
 *
 * The seller converges an identity on every chain in ERC8004_CHAINS (primary first). All of them
 * share one Agent Card — one tokenURI — whose `registrations[]` names each (registry, agentId)
 * pair. Each chain is converged in turn with its own client; every card write re-reads the card
 * and upserts only this chain's entry, so no chain ever drops another's.
 *
 * The controlling invariant: **once an agentId exists on ANY chain in this process, this tool
 * never returns an error response.** A text-only error would discard the state the caller just
 * paid gas for — the exact bug that made the old `create_agent` dangerous. A chain that fails is
 * reported in its own `identities[]` entry and in `warnings`; the others still come back.
 */
import { getAddress } from 'viem';
import {
  AGENT_SPLITTER,
  SWARM_AGENT_ID,
  getAgentSplitter,
  setAgentSplitter,
  upsertRegistration,
} from '@solarpunk/erc8004-adapter';
import type { AgentCard, AgentRegistration, ERC8004Client } from '@solarpunk/erc8004-adapter';
import { CHAIN_CAIP2 } from '../../chains';
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
  fetchAgentCard,
  hasAgentIdMetadata,
  identityContext,
  mintAgent,
  publishAgentCard,
  registrationEntry,
  writeClient,
} from '../../agent-identity';
import type { Candidate, IdentityContext } from '../../agent-identity';
import {
  configuredRails,
  createSplitter,
  factoryAddress,
  identityRail,
  readSplitter,
  sellerAddress,
} from '../../splitter';
import {
  RegisterAgentArgs,
  RegisterAgentChainIdentity,
  RegisterAgentIdentity,
  RegisterAgentLink,
  RegisterAgentResult,
  RegisterAgentSplitter,
} from './models';
import { RPC_TIMEOUT_MS, TX_TIMEOUT_MS } from '../../constants';

function identityRailOrNull(): string | null {
  try {
    return identityRail();
  } catch {
    return null;
  }
}

function pickCandidate(candidates: Candidate[], verdict: Candidate['verdict']): Candidate | null {
  const matching = candidates.filter((c) => c.verdict === verdict);

  if (matching.length === 0) {
    return null;
  }

  return matching.reduce((lowest, c) => (BigInt(c.agentId) < BigInt(lowest.agentId) ? c : lowest));
}

/**
 * The card as this run knows it. `written` is what we last published, which may be newer than
 * what a feed read returns for a moment after the write.
 */
interface CardState {
  card: AgentCard | null;
  written: AgentCard | null;
}

/**
 * Publish `desired` content carrying every known registration, plus `entry` when given.
 *
 * Read-modify-write: re-read the card right before writing and keep every entry it holds, then
 * fold in what this run already wrote (a feed read can trail our own write), then upsert this
 * chain's entry. A write on chain B therefore never drops chain A's registration.
 */
async function writeCard(
  ctx: IdentityContext,
  desired: AgentCard,
  state: CardState,
  entry: AgentRegistration | null,
  postageBatchId?: string,
): Promise<string> {
  const card = await mergedCard(ctx, desired, state, entry);
  const reference = await publishAgentCard(ctx, card, postageBatchId);
  state.card = card;
  state.written = card;
  return reference;
}

async function mergedCard(
  ctx: IdentityContext,
  desired: AgentCard,
  state: CardState,
  entry: AgentRegistration | null,
): Promise<AgentCard> {
  const fresh = await fetchAgentCard(ctx);
  let merged: AgentCard = { ...desired, registrations: fresh.card?.registrations ?? [] };
  for (const known of [state.card, state.written]) {
    for (const reg of known?.registrations ?? []) merged = upsertRegistration(merged, reg);
  }
  if (entry) merged = upsertRegistration(merged, entry);
  if ((merged.registrations ?? []).length === 0) merged = { ...merged, registrations: undefined };
  return merged;
}

/** The desired content plus every registration we know about, without a network read. */
function knownCard(desired: AgentCard, state: CardState, entry: AgentRegistration): AgentCard {
  let merged: AgentCard = { ...desired, registrations: [] };
  for (const known of [state.card, state.written]) {
    for (const reg of known?.registrations ?? []) merged = upsertRegistration(merged, reg);
  }
  return upsertRegistration(merged, entry);
}

interface ChainRun {
  chain: string;
  chainId: string;
  erc8004: ERC8004Client | null;
  identity: RegisterAgentIdentity;
  agentId: bigint | null;
  /**
   * A failure that, on a single chain, used to be the tool's error response. It becomes one only
   * when no chain produced an agentId; otherwise it is reported on this chain and in warnings.
   */
  fatal?: string;
}

interface ConvergeOptions {
  dryRun: boolean;
  refreshCard: boolean;
  fromBlock?: number;
  postageBatchId?: string;
}

/** Steps B–D (discovery, converge, metadata backfill) on one chain. */
export async function convergeIdentity(
  chain: string,
  ctx: IdentityContext,
  desiredCard: AgentCard,
  state: CardState,
  opts: ConvergeOptions,
  warnings: string[],
): Promise<ChainRun> {
  const chainId = CHAIN_CAIP2[chain] ?? '';
  const identity: RegisterAgentIdentity = {
    status: 'failed',
    agentId: null,
    agentURI: ctx.agentURI,
    verified: false,
    metadataStatus: 'missing',
    candidatesScanned: 0,
    candidates: [],
  };
  const run: ChainRun = { chain, chainId, erc8004: null, identity, agentId: null };
  const fail = (message: string): ChainRun => {
    identity.status = 'failed';
    identity.error = message;
    run.fatal = `[${chain}] ${message}`;
    return run;
  };

  let erc8004: ERC8004Client;
  try {
    erc8004 = writeClient(ctx, chain);
  } catch (err) {
    return fail(`cannot build an ERC-8004 client: ${getErrorMessage(err)}`);
  }
  run.erc8004 = erc8004;

  // ── B. Discovery ──────────────────────────────────────────────────────────
  let existingCard: AgentCard | null;
  try {
    const discovery = await discoverCandidates(erc8004, ctx, opts.fromBlock);
    identity.candidates = discovery.candidates;
    identity.candidatesScanned = discovery.candidates.length;
    if (!state.card) state.card = discovery.card;
    // Prefer what this run published over a feed read that may trail it.
    existingCard = state.written ?? discovery.card;

    // Distinguish "found nothing" from "could not look". Minting on the latter would spend
    // gas on a duplicate because an RPC blipped.
    const lookupFailed = [discovery.cardError, discovery.scanError].filter(Boolean);
    if (discovery.candidates.every((c) => c.verdict === 'rejected') && lookupFailed.length > 0) {
      identity.discoveryError = lookupFailed.join('; ');
      return fail(
        'Discovery failed, so minting was suppressed to avoid creating a duplicate agent. ' +
          `Resolve the transport error and retry. Details: ${identity.discoveryError}`,
      );
    }
    if (discovery.cardError) {
      warnings.push(`[${chain}] Agent Card lookup degraded: ${discovery.cardError}`);
    }
    if (discovery.scanError) {
      warnings.push(`[${chain}] MetadataSet scan degraded: ${discovery.scanError}`);
    }
  } catch (err) {
    return fail(`discovery failed: ${getErrorMessage(err)}`);
  }

  const verified = pickCandidate(identity.candidates, 'verified');
  const repairable = pickCandidate(identity.candidates, 'repairable');
  const ownedByOther = identity.candidates.find(
    (c) => c.verdict === 'rejected' && c.reason?.startsWith('owned by'),
  );

  if (identity.candidates.filter((c) => c.verdict !== 'rejected').length > 1) {
    warnings.push(
      `[${chain}] ${identity.candidates.length} agents resolve to this feed owner — a prior ` +
        'double-mint. Using the lowest agentId.',
    );
  }

  // ── C. Converge on an identity ────────────────────────────────────────────
  if (verified) {
    run.agentId = BigInt(verified.agentId);
    identity.agentId = verified.agentId;
    identity.verified = true;
    identity.status = 'existing';

    // Card content drift (name/description/capabilities/x402 changed between releases).
    if (opts.refreshCard && existingCard) {
      const target = knownCard(desiredCard, state, registrationEntry(erc8004, run.agentId));
      if (!cardsEqual(target, existingCard)) {
        if (opts.dryRun) {
          identity.status = 'would-refresh';
        } else {
          try {
            identity.cardReference = await writeCard(
              ctx,
              desiredCard,
              state,
              registrationEntry(erc8004, run.agentId),
              opts.postageBatchId,
            );
            identity.status = 'refreshed';
          } catch (err) {
            // Non-fatal: the agent is registered and sellable, the card is just stale.
            warnings.push(`[${chain}] Agent Card refresh failed: ${getErrorMessage(err)}`);
          }
        }
      }
    }
  } else if (repairable) {
    run.agentId = BigInt(repairable.agentId);
    identity.agentId = repairable.agentId;
    if (opts.dryRun) {
      identity.status = 'would-repair';
    } else {
      try {
        identity.cardReference = await writeCard(
          ctx,
          desiredCard,
          state,
          registrationEntry(erc8004, run.agentId),
          opts.postageBatchId,
        );
        identity.status = 'repaired';
        identity.verified = true;
      } catch (err) {
        identity.status = 'incomplete';
        identity.error =
          `Agent ${identity.agentId} is ours but its Agent Card could not be rewritten: ` +
          `${getErrorMessage(err)}. Re-run register_agent once Swarm is reachable.`;
        warnings.push(`[${chain}] ${identity.error}`);
      }
    }
  } else if (ownedByOther) {
    // Never mint past this. A second NFT for the same feed is unrecoverable; an error is not.
    return fail(
      `agent ${ownedByOther.agentId} already points at this feed owner (${ctx.feedOwner}) but ` +
        `is owned by ${ownedByOther.owner}, not the PRIVATE_KEY signer ${ctx.signer}. Minting ` +
        'a second agent would orphan the first. Use the owning key, or transfer the NFT.',
    );
  } else if (opts.dryRun) {
    identity.status = 'would-mint';
  } else {
    // ── Mint. Independent try blocks: the tokenURI must exist before the mint, and a failure in
    // the post-mint card write must never discard the agentId we just paid for. The pre-mint
    // card carries every other chain's registration forward.
    try {
      const preMint = await mergedCard(ctx, desiredCard, state, null);
      if (!existingCard || !cardsEqual(preMint, existingCard)) {
        identity.cardReference = await publishAgentCard(ctx, preMint, opts.postageBatchId);
        state.card = preMint;
        state.written = preMint;
      }
    } catch (err) {
      return fail(
        `failed to upload the Agent Card to Swarm: ${getErrorMessage(err)}. No NFT was minted.`,
      );
    }

    let txHash: string;
    try {
      const minted = await mintAgent(erc8004, ctx);
      run.agentId = minted.agentId;
      txHash = minted.txHash;
    } catch (err) {
      return fail(`the ERC-8004 mint failed: ${getErrorMessage(err)}. No NFT was minted.`);
    }

    // An agentId now exists. From here nothing may produce an error response.
    identity.agentId = run.agentId.toString();
    identity.txHash = txHash;
    identity.metadataStatus = 'present'; // written atomically in register()

    try {
      identity.cardReference = await writeCard(
        ctx,
        desiredCard,
        state,
        registrationEntry(erc8004, run.agentId),
        opts.postageBatchId,
      );
      identity.status = 'minted';
      identity.verified = true;
    } catch (err) {
      identity.status = 'incomplete';
      identity.error =
        `Minted agent ${identity.agentId} (tx ${txHash}) but the Agent Card write failed: ` +
        `${getErrorMessage(err)}. Re-run register_agent — the next call will repair the card ` +
        'rather than mint again.';
      warnings.push(`[${chain}] ${identity.error}`);
    }
  }

  // ── D. Backfill swarm_agent_id ────────────────────────────────────────────
  // Agents minted without it are invisible to the fallback scan forever.
  if (run.agentId !== null && identity.metadataStatus !== 'present') {
    try {
      if (opts.dryRun) {
        // The read is free; only the write is suppressed. Reporting would-backfill without
        // looking would make every dry run claim work that may not be needed.
        identity.metadataStatus = (await hasAgentIdMetadata(erc8004, ctx, run.agentId))
          ? 'present'
          : 'would-backfill';
      } else {
        identity.metadataStatus = await ensureAgentIdMetadata(erc8004, ctx, run.agentId);
      }
    } catch (err) {
      identity.metadataStatus = 'failed';
      warnings.push(
        `[${chain}] Could not resolve ${SWARM_AGENT_ID} metadata: ${getErrorMessage(err)}`,
      );
    }
  }

  return run;
}

/** Step F on one chain: bind this chain's clone to this chain's agentId. Never fatal. */
async function linkSplitter(
  run: ChainRun,
  clone: RegisterAgentSplitter | undefined,
  dryRun: boolean,
  warnings: string[],
): Promise<RegisterAgentLink> {
  const link: RegisterAgentLink = {
    status: 'skipped',
    metadataKey: AGENT_SPLITTER,
    splitter: clone?.address ?? null,
  };

  if (run.agentId === null || !run.erc8004) {
    link.reason = 'no agentId to bind';
    return link;
  }
  if (!clone?.address) {
    link.reason = `no splitter address on ${run.chainId || run.chain} to bind`;
    return link;
  }

  const agentId = run.agentId;
  const erc8004 = run.erc8004;
  try {
    const existing = await withTimeout(
      getAgentSplitter(erc8004.identity, agentId),
      RPC_TIMEOUT_MS,
      `RPC getMetadata(${agentId}, ${AGENT_SPLITTER}) on ${run.chain}`,
    );
    if (existing && getAddress(existing) === getAddress(clone.address)) {
      link.status = 'already-linked';
    } else if (dryRun) {
      link.status = 'would-link';
      if (existing) link.previousSplitter = existing;
    } else {
      link.txHash = await withTimeout(
        setAgentSplitter(erc8004.identity, agentId, clone.address),
        TX_TIMEOUT_MS,
        `setMetadata(${AGENT_SPLITTER}) on ${run.chain}`,
      );
      link.status = existing ? 'repointed' : 'linked';
      if (existing) link.previousSplitter = existing;
    }
  } catch (err) {
    // Never fatal: the link is a discovery index, not a precondition for selling.
    link.status = 'failed';
    link.error = getErrorMessage(err);
    warnings.push(
      `[${run.chain}] Splitter link failed: ${link.error}. The agent can still sell, but ` +
        'indexers cannot attribute its sales.',
    );
  }
  return link;
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

  const desiredCard = buildAgentCard({
    name: args.name,
    description: args.description,
    image: args.image,
    version: args.version,
    x402: args.x402,
    capabilities: args.capabilities,
    catalogFeedOwner: ctx.feedOwner,
  });

  // ── B–D. Identity on every chain, sequentially, sharing one card ───────────
  const state: CardState = { card: null, written: null };
  const runs: ChainRun[] = [];
  for (const chain of config.chain.chains) {
    const caip2 = CHAIN_CAIP2[chain];
    const fromBlock =
      (caip2 ? args.fromBlocks?.[caip2] : undefined) ??
      (chain === config.chain.chain ? args.fromBlock : undefined);
    runs.push(
      await convergeIdentity(
        chain,
        ctx,
        desiredCard,
        state,
        { dryRun, refreshCard, fromBlock, postageBatchId: args.postageBatchId },
        warnings,
      ),
    );
  }

  // Before any agentId exists, a fatal failure is still safe to return as an error.
  if (runs.every((r) => r.agentId === null)) {
    const fatal = runs.filter((r) => r.fatal).map((r) => r.fatal);
    if (fatal.length > 0) return getToolErrorResponse(`register_agent: ${fatal.join(' ')}`);
  }
  for (const run of runs) {
    if (run.fatal) warnings.push(run.fatal);
  }

  // ── E. Splitter — one clone per configured payment rail ───────────────────
  // The seller pays gas on every rail, so a rail whose wallet is unfunded fails on its own and
  // the others still converge.
  let resolvedSeller: string | null = null;
  try {
    resolvedSeller = args.seller
      ? getAddress(args.seller)
      : (sellerAddress() ?? getAddress(ctx.signer));
  } catch {
    warnings.push(`Invalid seller address: ${args.seller}`);
  }

  const rails = configuredRails();
  const splitters: RegisterAgentSplitter[] = [];

  if (args.skipSplitter) {
    splitters.push({ status: 'skipped', address: null, seller: null, factory: null });
  } else if (rails.length === 0 || !resolvedSeller) {
    splitters.push({ status: 'unconfigured', address: null, seller: null, factory: null });
    warnings.push(
      'SPLITTER_FACTORY_ADDRESSES is unset, so no revenue splitter was resolved. Listings will ' +
        'have to name a payTo explicitly, and such sales are untaxed and earn no ' +
        'Proof-of-Purchase.',
    );
  } else {
    for (const rail of rails) {
      const entry: RegisterAgentSplitter = {
        status: 'unconfigured',
        address: null,
        seller: resolvedSeller,
        factory: factoryAddress(rail) ?? null,
        chainId: rail,
      };
      splitters.push(entry);
      if (!entry.factory) continue;
      const splitterCtx = {
        factory: entry.factory as `0x${string}`,
        seller: resolvedSeller as `0x${string}`,
        chainId: rail,
      };
      try {
        if (dryRun) {
          const read = await readSplitter(splitterCtx);
          entry.address = read.splitter;
          entry.treasury = read.treasury;
          entry.taxBps = read.taxBps;
          entry.status = read.deployed ? 'existing' : 'would-deploy';
        } else {
          const ensured = await createSplitter(splitterCtx);
          entry.address = ensured.splitter;
          entry.treasury = ensured.treasury;
          entry.taxBps = ensured.taxBps;
          entry.txHash = ensured.txHash;
          entry.status = ensured.alreadyExisted ? 'existing' : 'deployed';
        }
      } catch (err) {
        entry.status = 'failed';
        entry.error = getErrorMessage(err);
        warnings.push(`Splitter resolution on ${rail} failed: ${entry.error}`);
      }
    }
  }

  // The headline clone: the identity rail's when configured, else the first resolved one.
  const splitter =
    splitters.find((s) => s.chainId === identityRailOrNull()) ??
    splitters.find((s) => s.address) ??
    splitters[0];

  // ── F. Link — per chain, that chain's clone on that chain's registry ──────
  const identities: RegisterAgentChainIdentity[] = [];
  for (const run of runs) {
    const clone = splitters.find((s) => s.chainId && s.chainId === run.chainId);
    const link = await linkSplitter(run, clone, dryRun, warnings);
    identities.push({ chain: run.chain, chainId: run.chainId, identity: run.identity, link });
  }

  const primary = identities[0];
  const result: RegisterAgentResult = {
    feedOwner: ctx.feedOwner,
    signer: ctx.signer,
    chain: config.chain.chain,
    dryRun,
    identity: primary.identity,
    splitter,
    splitters,
    link: primary.link,
    identities,
    warnings,
    message:
      `${dryRun ? '[dry run] ' : ''}identity ` +
      identities
        .map(
          (i) =>
            `${i.chain} ${i.identity.status}` +
            (i.identity.agentId ? ` (agent ${i.identity.agentId})` : ''),
        )
        .join(', ') +
      `; splitter ${splitters
        .map((s) => (s.chainId ? `${s.chainId} ${s.status}` : s.status))
        .join(', ')}` +
      `; link ${identities.map((i) => `${i.chain} ${i.link.status}`).join(', ')}.`,
  };

  return getResponseWithStructuredContent(result);
}
