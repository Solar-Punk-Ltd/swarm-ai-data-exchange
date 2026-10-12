import { CHAIN_QUERY_PARAM, config } from '../config/env';
import { href } from '../hooks/useRoute';
import QrCode from './QrCode';
import styles from './styles.module.css';

/**
 * The demo hand-off page: a QR code that moves the audience from the projected dashboard onto
 * their own phone.
 *
 * `VITE_DEMO_FLOW_BASE_URL` overrides the origin so the code can point at a tunnel when the demo
 * machine is not on the audience's network. The resolved URL is printed under the code on purpose
 * — a scan that fails on stage is recoverable if the address is readable, and it makes a QR
 * pointing at localhost obvious before anyone tries it.
 */
export default function DevconPage() {
  const base = config.demoFlowBaseUrl ?? window.location.origin;
  // Always carries the chain selected in the header dropdown, so the phone creates and funds its
  // buyer on that chain. Set explicitly rather than relying on `href()` copying the current URL:
  // the selection may have come from localStorage, leaving no `?chain=` in this page's URL.
  const url = new URL(`${base}${href('claim-wallet')}`);
  url.searchParams.set(CHAIN_QUERY_PARAM, String(config.chain.id));
  const claimWalletUrl = url.toString();

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Devcon demo</h2>
      </div>
      <div className={`${styles.card} ${styles.qrCard}`}>
        <div className={styles.qrCopy}>
          <p className={styles.qrLead}>Scan the QR code and navigate to the page in order to:</p>
          <p className={styles.qrOutcome}>
            Create a buyer agent that pays on {config.chain.name} to purchase a funded wallet from a
            seller agent.
          </p>
          <a className={styles.qrUrl} href={claimWalletUrl}>
            {claimWalletUrl}
          </a>
        </div>

        <div className={styles.qrFrame}>
          <QrCode value={claimWalletUrl} />
        </div>
      </div>
    </section>
  );
}
