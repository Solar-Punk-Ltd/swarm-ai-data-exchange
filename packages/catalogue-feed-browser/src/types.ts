export interface ActGrantResult {
  swarmHash: string;
  actHistoryAddress: string;
  granteeRef: string;
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
