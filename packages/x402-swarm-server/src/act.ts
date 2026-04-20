import { ActGrantResult } from "./types";

// TODO: call Bee node ACT API to add buyer to grantee list and retrieve ACT metadata
// Reference: https://docs.ethswarm.org/docs/develop/act
export async function grantActAccess(
  swarmHash: string,
  _buyerPublicKey?: string
): Promise<ActGrantResult> {
  return {
    swarmHash,
    actHistoryAddress: "",
    publisherPublickey: "",
  };
}
