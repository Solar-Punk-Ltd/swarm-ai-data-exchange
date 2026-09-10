import { useEffect, useState } from 'react';
import { config } from '../config/env';
import { txUrl } from '../config/chain';
import useClaim from '../hooks/useClaim';
import type { ClaimState } from '../lib/devcon';
import AddressLink from './AddressLink';
import styles from './styles.module.css';

/**
 * The QR code's target — the phone-side surface, reached by scanning `#/devcon`.
 *
 * On arrival it asks `agent-orchestration-api` to deploy a buyer agent for this visitor, then
 * narrates its progress until it has bought something. The agent is handed back when this page
 * closes, or after the server's TTL, whichever comes first.
 *
 * The progress steps are not decoration. Getting a container running takes seconds (a USDC
 * transfer blocks on a chain receipt) and the purchase itself tens more, and `starting` and
 * `buying` are where nearly all of that time goes — a single spinner over half a minute reads as
 * a hang, which is the one thing this page cannot afford to look like on stage.
 *
 * Absent from the nav on purpose: nothing links to a page you arrive at by scanning.
 */

interface Step {
  state: ClaimState;
  label: string;
  detail: string;
}

const STEPS: Step[] = [
  { state: 'provisioning', label: 'Creating', detail: 'Generating a wallet for your agent' },
  { state: 'funding', label: 'Funding', detail: 'Sending it USDC to spend' },
  { state: 'starting', label: 'Starting', detail: 'Booting the agent' },
  { state: 'buying', label: 'Buying', detail: 'Your agent is shopping the seller catalog' },
  { state: 'purchased', label: 'Bought', detail: 'Your agent bought an item' },
];

const STEP_INDEX: Record<string, number> = Object.fromEntries(
  STEPS.map((step, index) => [step.state, index]),
);

/**
 * Ticks locally rather than rendering `claim.secondsRemaining`, which only moves when the 5s poll
 * lands — a clock that jumps in five-second steps looks broken.
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

function Steps({ state }: { state: ClaimState }) {
  const current = STEP_INDEX[state] ?? 0;
  return (
    <ol className={styles.claimSteps}>
      {STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        const className = [
          styles.claimStep,
          done ? styles.claimStepDone : '',
          active ? styles.claimStepOn : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <li key={step.state} className={className}>
            <span className={styles.claimStepDot} aria-hidden="true" />
            <span className={styles.claimStepText}>
              <span className={styles.claimStepLabel}>{step.label}</span>
              {active && <span className={styles.claimStepDetail}>{step.detail}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function ClaimWalletPage() {
  const { claim, error, errorCode, loading, configured, retry } = useClaim();

  // The clock is only meaningful while the agent is still doing something.
  const counting = Boolean(claim && !claim.released && claim.state !== 'purchased');
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
          <Steps state="provisioning" />
        </div>
      </section>
    );
  }

  const explorer = claim.txHash ? txUrl(config.chain, claim.txHash) : undefined;
  const finished = claim.state === 'purchased';
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
              {finished
                ? 'Your agent bought an item from the seller.'
                : 'Your buyer agent is live.'}
            </p>

            <Steps state={claim.state} />

            <div className={styles.claimFacts}>
              {claim.buyerAddress && (
                <div className={styles.claimFact}>
                  <span className={styles.claimFactLabel}>Your agent</span>
                  <AddressLink address={claim.buyerAddress} />
                </div>
              )}
              {claim.itemId && (
                <div className={styles.claimFact}>
                  <span className={styles.claimFactLabel}>Item</span>
                  <span className={styles.claimFactValue} title={claim.itemId}>
                    {claim.itemId.slice(0, 10)}…
                  </span>
                </div>
              )}
              {claim.txHash && (
                <div className={styles.claimFact}>
                  <span className={styles.claimFactLabel}>Payment</span>
                  {explorer ? (
                    <a
                      className={styles.pillLink}
                      href={explorer}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {claim.txHash.slice(0, 10)}…
                    </a>
                  ) : (
                    <span className={styles.claimFactValue}>{claim.txHash.slice(0, 10)}…</span>
                  )}
                </div>
              )}
            </div>

            {gone ? (
              <p className={styles.claimHint}>
                {finished
                  ? 'Your agent has finished and been shut down.'
                  : 'Your agent has been returned. Reload the page to get another one.'}
              </p>
            ) : (
              <p className={styles.claimHint}>
                {remaining !== undefined && (
                  <span className={styles.claimCountdown}>{clock(remaining)}</span>
                )}
                Your agent is yours for up to ten minutes, and is shut down when you close this
                page.
              </p>
            )}

            {gone && (
              <button
                type="button"
                className={`${styles.button} ${styles.buttonPrimary}`}
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
