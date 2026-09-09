import { config } from '../config/env';
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
  const claimWalletUrl = `${base}/#/claim-wallet`;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Devcon demo</h2>
      </div>
      <div className={`${styles.card} ${styles.qrCard}`}>
        <div className={styles.qrCopy}>
          <p className={styles.qrLead}>Scan the QR code and navigate to the page in order to:</p>
          <p className={styles.qrOutcome}>
            Create a buyer agent that purchases a funded wallet from a seller agent.
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
