/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TREASURY_ADDRESS?: string;
  readonly VITE_SPLITTER_FACTORY_ADDRESS?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_REFRESH_INTERVAL_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  ethereum?: import('viem').EIP1193Provider;
}
