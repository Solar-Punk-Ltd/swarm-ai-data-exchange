import { useCallback, useEffect, useState } from 'react';
import useClaim from '../hooks/useClaim';
import type { Claim, ClaimItem, ClaimState } from '../lib/devcon';
import AddressLink from './AddressLink';
import styles from './styles.module.css';

/**
 * The QR code's target — the phone-side surface, reached by scanning `/devcon`.
 *
 * On arrival it asks `agent-orchestration-api` to deploy a buyer agent for this visitor, narrates
 * what that agent does, and shows what it bought. The agent is handed back when this page closes,
 * or after the server's TTL, whichever comes first.
 */

type StepKey =
  | 'created'
  | 'funded'
  | 'started'
  | 'seller'
  | 'purchase'
  | 'settled'
  | 'download'
  | 'ready';

interface Step {
  key: StepKey;
  /** States that belong to this step. The first is the one that activates it. */
  states: ClaimState[];
  label: string;
  /** Shown while this step is the current one. */
  detail: string;
}

const STEPS: Step[] = [
  {
    key: 'created',
    states: ['provisioning'],
    label: 'Buyer agent created',
    detail: 'Generating its wallet',
  },
  {
    key: 'funded',
    states: ['funding'],
    label: 'Wallet funded',
    detail: 'Sending it USDC to spend',
  },
  { key: 'started', states: ['starting'], label: 'Agent started', detail: 'Booting the agent' },
  {
    key: 'seller',
    states: ['discovering', 'seller_found'],
    label: 'Seller agent discovered',
    detail: 'Looking up the seller on-chain',
  },
  {
    key: 'purchase',
    states: ['purchasing'],
    label: 'Purchase initiated',
    detail: 'Paying over x402',
  },
  {
    key: 'settled',
    states: ['settled'],
    label: 'Purchase finalized',
    detail: 'Settling on Base Sepolia',
  },
  {
    key: 'download',
    states: ['downloading'],
    label: 'Downloading purchased item',
    detail: 'Decrypting from Swarm',
  },
  { key: 'ready', states: ['delivered'], label: 'Item ready', detail: 'Fetching your item' },
];

const STEP_OF: Record<string, number> = Object.fromEntries(
  STEPS.flatMap((step, index) => step.states.map((state) => [state, index])),
);

/**
 * Ticks locally rather than rendering `claim.secondsRemaining`, which only moves when a poll lands
 * — a clock that jumps in whole seconds at a time looks broken.
 */
function useCountdown(expiresAt: string | null | undefined, active: boolean): number | undefined {
  const [remaining, setRemaining] = useState<number>();

  useEffect(() => {
    if (!expiresAt || !active) {
      setRemaining(undefined);
      return;
    }
    const target = new Date(expiresAt).getTime();
    if (Number.isNaN(target)) return;
    const tick = () => setRemaining(Math.max(0, Math.round((target - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, active]);

  return remaining;
}

function clock(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Per-step detail, once it is known. Both the funding and the settlement step carry a live
 * explorer link — the funding amount and its transaction are what make "your agent has money"
 * checkable rather than a claim.
 */
function StepDetail({
  step,
  claim,
  active,
  fallback,
}: {
  step: StepKey;
  claim: Claim;
  active: boolean;
  fallback: string;
}) {
  if (step === 'funded' && claim.funding.amount) {
    return (
      <span className={styles.claimStepDetail}>
        {claim.funding.amount} USDC
        {claim.funding.txHash && (
          <>
            {' · '}
            <AddressLink address={claim.funding.txHash} kind="tx" />
          </>
        )}
      </span>
    );
  }
  if (step === 'seller' && (claim.seller.name || claim.seller.agentId)) {
    return (
      <span className={styles.claimStepDetail}>
        {claim.seller.name ?? `agent ${claim.seller.agentId}`}
        {typeof claim.seller.itemCount === 'number' && ` · ${claim.seller.itemCount} item(s)`}
      </span>
    );
  }
  if (step === 'purchase' && claim.itemId) {
    return (
      <span className={styles.claimStepDetail} title={claim.itemId}>
        item {claim.itemId.slice(0, 10)}…
      </span>
    );
  }
  if (step === 'settled' && claim.txHash) {
    return (
      <span className={styles.claimStepDetail}>
        <AddressLink address={claim.txHash} kind="tx" />
      </span>
    );
  }

  if (active) {
    return <span className={styles.claimStepDetail}>{fallback}</span>;
  }

  return null;
}

/**
 * The cumulative checklist. Reached steps stay visible with a tick; the current one is
 * highlighted. `reached` comes from the claim's history rather than from its state alone, because
 * a step whose whole duration fell between two polls still happened.
 */
function Steps({ claim }: { claim: Claim }) {
  const mapped = STEP_OF[claim.state];
  const terminal =
    claim.state === 'delivered' || claim.state === 'expired' || claim.state === 'failed';

  const reached = new Set<number>();

  if (mapped !== undefined) {
    reached.add(mapped);
  }

  for (const [state] of claim.history) {
    const index = STEP_OF[state];

    if (index !== undefined) {
      reached.add(index);
    }
  }
  const furthest = reached.size > 0 ? Math.max(...reached) : 0;
  const current = mapped ?? furthest;

  return (
    <ol className={styles.claimSteps}>
      {STEPS.map((step, index) => {
        const done = index < furthest || (index === furthest && terminal);
        const active = index === current && !terminal;
        const pending = index > furthest;
        const className = [
          styles.claimStep,
          done ? styles.claimStepDone : '',
          active ? styles.claimStepOn : '',
          pending ? styles.claimStepPending : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <li key={step.key} className={className}>
            <span className={styles.claimStepDot} aria-hidden="true" />
            <span className={styles.claimStepText}>
              <span className={styles.claimStepLabel}>{step.label}</span>
              <StepDetail step={step.key} claim={claim} active={active} fallback={step.detail} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function DeliveredItem({ item }: { item: ClaimItem }) {
  const [copied, setCopied] = useState(false);
  const content = item.content;

  const copy = useCallback(() => {
    if (!content) {
      return;
    }

    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [content]);

  return (
    <div className={styles.claimItem}>
      <div className={styles.claimItemHead}>
        <span className={styles.claimFactLabel}>Your item</span>
        {item.name && <span className={styles.claimItemName}>{item.name}</span>}
      </div>

      {content ? (
        <>
          <pre className={styles.claimItemBody}>{content}</pre>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={copy}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          {item.truncated && (
            <p className={styles.claimHint}>
              Showing the first part only — the item is {item.size} bytes.
            </p>
          )}
        </>
      ) : (
        <p className={styles.claimHint}>
          {item.contentWithheld
            ? 'Open this page in the browser that claimed the agent to see your item.'
            : `This item is not text (${item.size} bytes), so it cannot be shown here.`}
        </p>
      )}
    </div>
  );
}

export default function ClaimWalletPage() {
  const { claim, error, errorCode, loading, configured, retry } = useClaim();

  const counting = Boolean(claim && !claim.released && claim.state !== 'delivered');
  const remaining = useCountdown(claim?.expiresAt, counting);

  const heading = <h2 className={styles.sectionTitle}>Claim wallet</h2>;

  if (!configured) {
    return (
      <section className={styles.section}>
        <div className={styles.sectionHead}>{heading}</div>
        <div className={styles.empty}>
          No agent orchestration API configured. Set <code>VITE_DEVCON_API_URL</code> to the address
          of <code>agent-orchestration-api</code> and reload.
        </div>
      </section>
    );
  }

  // A hard failure with no agent yet: nothing to narrate, so say what happened and offer a retry.
  if (error && !claim) {
    const capacity = errorCode === 'at_capacity';
    return (
      <section className={styles.section}>
        <div className={styles.sectionHead}>{heading}</div>
        <div className={`${styles.banner} ${capacity ? styles.bannerWarn : styles.bannerDanger}`}>
          {error}
        </div>
        <div className={styles.claimCard}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={retry}
          >
            {capacity ? 'Try again' : 'Retry'}
          </button>
        </div>
      </section>
    );
  }

  if (loading || !claim) {
    return (
      <section className={styles.section}>
        <div className={styles.sectionHead}>{heading}</div>
        <div className={styles.claimCard}>
          <p className={styles.claimLead}>Creating a buyer agent for you…</p>
        </div>
      </section>
    );
  }

  const delivered = claim.state === 'delivered';
  const gone = claim.released || claim.state === 'expired';
  const broke = claim.state === 'failed';

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>{heading}</div>

      {/* A failed poll while the agent is still running: worth showing, not worth erasing the page. */}
      {error && !broke && <div className={`${styles.banner} ${styles.bannerWarn}`}>{error}</div>}

      <div className={styles.claimCard}>
        {broke ? (
          <>
            <p className={styles.claimLead}>Your agent could not be deployed.</p>
            <p className={styles.claimHint}>{claim.error ?? 'No reason was reported.'}</p>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={retry}
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <p className={styles.claimLead}>
              {delivered ? 'Your agent bought this for you.' : 'Your buyer agent is working.'}
            </p>

            <Steps claim={claim} />

            {claim.item && <DeliveredItem item={claim.item} />}

            {claim.buyerAddress && (
              <div className={styles.claimFacts}>
                <div className={styles.claimFact}>
                  <span className={styles.claimFactLabel}>Your agent</span>
                  <AddressLink address={claim.buyerAddress} />
                </div>
              </div>
            )}

            {gone ? (
              <p className={styles.claimHint}>
                {delivered
                  ? 'Your agent has finished and been shut down. The item above is yours to keep.'
                  : 'Your agent has been returned. Reload the page to get another one.'}
              </p>
            ) : (
              <p className={styles.claimHint}>
                {remaining !== undefined && (
                  <span className={styles.claimCountdown}>{clock(remaining)}</span>
                )}
                Your agent is yours while this page is open, and is shut down when you close it.
              </p>
            )}

            {gone && !delivered && (
              <button
                type="button"
                className={`${styles.button} ${styles.buttonPrimary}`}
                style={{ marginTop: '20px' }}
                onClick={retry}
              >
                Claim another
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
