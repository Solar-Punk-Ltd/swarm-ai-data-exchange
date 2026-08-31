/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TREASURY_ADDRESS?: string;
  readonly VITE_SPLITTER_FACTORY_ADDRESS?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_REFRESH_INTERVAL_MS?: string;
  readonly VITE_IDENTITY_REGISTRY_ADDRESS?: string;
  readonly VITE_IDENTITY_REGISTRY_FROM_BLOCK?: string;
  readonly VITE_LOG_CHUNK_BLOCKS?: string;
  readonly VITE_SWARM_GATEWAY_URL?: string;
  readonly VITE_CATALOGUE_FEED_BROWSER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  ethereum?: import('viem').EIP1193Provider;
}
