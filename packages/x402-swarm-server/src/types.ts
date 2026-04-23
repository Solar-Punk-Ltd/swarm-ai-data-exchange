export interface ActGrantResult {
  swarmHash: string;
  actHistoryAddress: string;
  granteeRef: string;
  publisherPublickey: string;
}

export interface MetadataEntry {
  key: string;
  value: string;
}

export interface DataItem {
  agentId: number;
  swarmHash: string;
  actHistoryRef: string;
  granteeRef: string;
  publisherPublicKey: string;
  displayName: string;
  metadata: MetadataEntry[];
  tags: string[];
}

export interface SwarmMetadataCatalogue {
  schemeVersion: string;
  dataItems: DataItem[];
}

export class CatalogueEntryNotFound extends Error {
  constructor(swarmHash: string) {
    super(`No catalogue entry for swarmHash ${swarmHash}`);
    this.name = 'CatalogueEntryNotFound';
  }
}
