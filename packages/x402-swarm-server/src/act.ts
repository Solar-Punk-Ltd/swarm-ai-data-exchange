import { ActGrantResult } from "./types";

// TODO: call Bee node ACT API to add buyerPublicKey to the ACT grantee list
// Reference: https://docs.ethswarm.org/docs/develop/act
export async function grantActAccess(
  swarmHash: string,
  buyerPublicKey: string
): Promise<ActGrantResult> {
  void buyerPublicKey;
  return {
    swarmHash,
    actHistoryAddress: "",
    publisherPublickey: "",
  };
}
