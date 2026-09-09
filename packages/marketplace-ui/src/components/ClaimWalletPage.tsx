import styles from './styles.module.css';

/**
 * The QR code's target — the phone-side surface, reached by scanning `#/devcon`.
 *
 * Deliberately empty for now. It exists so the route, the flag gating and the phone layout are all
 * proven before any buyer-agent logic lands, and so the code on stage has something live to point
 * at. It is absent from the nav on purpose: nothing links to a page you arrive at by scanning.
 */
export default function ClaimWalletPage() {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Claim wallet</h2>
      </div>
      <div className={styles.empty}>
        Nothing here yet. This is where a buyer agent will be created to purchase a funded wallet
        from a seller agent.
      </div>
    </section>
  );
}
