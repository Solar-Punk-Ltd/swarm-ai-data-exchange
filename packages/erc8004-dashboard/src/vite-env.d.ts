/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Comma list of chain ids offered in the header dropdown, e.g. "84532,11142220". */
  readonly VITE_CHAIN_IDS?: string;
  /** Default chain id. Defaults to 84532 (Base Sepolia). */
  readonly VITE_CHAIN_ID?: string;
  /** RPC for the default chain (legacy single-chain form). */
  readonly VITE_RPC_URL?: string;
  /** Per-chain RPC overrides, e.g. VITE_RPC_URL_11142220. */
  readonly [key: `VITE_RPC_URL_${string}`]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
