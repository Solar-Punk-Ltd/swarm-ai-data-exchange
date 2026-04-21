export interface ActGrantResult {
  swarmHash: string;
  actHistoryAddress: string;
  publisherPublickey: string;
}

export interface DataItem {
  swarmHash: string;
  actHistoryRef: string;
  granteeRef: string;
  displayName: string;
  metadata: unknown[];
  tags: unknown[];
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
