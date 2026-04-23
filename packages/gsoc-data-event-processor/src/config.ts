import 'dotenv/config';

export interface GsocConfig {
  beeUrl: string;
  resourceId: string;
  topic: string;
}

export interface RuntimeConfig {
  gsoc: GsocConfig;
  queueConcurrency: number;
}

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(`gsoc-data-event-processor: missing required env var ${name}`);
  }
  return value.trim();
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    gsoc: {
      beeUrl: required('GSOC_BEE_URL', env.GSOC_BEE_URL),
      resourceId: required('GSOC_RESOURCE_ID', env.GSOC_RESOURCE_ID),
      topic: required('GSOC_TOPIC', env.GSOC_TOPIC),
    },
    queueConcurrency: parseInteger(env.QUEUE_CONCURRENCY, 1),
  };
}
