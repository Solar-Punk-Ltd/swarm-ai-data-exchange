import { useCallback, useState } from 'react';
import { config } from '../config/env';
import { addressUrl } from '../config/chain';
import styles from './styles.module.css';

/** `0x1234…abcd` — the full value stays available via `title` and the copy button. */
function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function CopyIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

export interface AddressLinkProps {
  address: string;
  /** Small uppercase prefix, e.g. "SELLER" or "SPLITTER". */
  label?: string;
}

export default function AddressLink({ address, label }: AddressLinkProps) {
  const [copied, setCopied] = useState(false);
  const href = addressUrl(config.chain, address);

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [address]);

  return (
    <span className={styles.address}>
      {label && <span className={styles.addressLabel}>{label}</span>}
      <span title={address}>{truncate(address)}</span>
      <button
        type="button"
        className={`${styles.iconButton} ${copied ? styles.copied : ''}`}
        onClick={copy}
        aria-label={copied ? 'Copied' : `Copy ${address}`}
        title={copied ? 'Copied' : 'Copy address'}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      {href && (
        <a
          className={styles.iconButton}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View ${address} on the block explorer`}
          title="Open in block explorer"
        >
          <ExternalIcon />
        </a>
      )}
    </span>
  );
}
