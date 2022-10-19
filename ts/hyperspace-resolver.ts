import { Program } from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";

import {
  HYPERSPACE_RESOLVER_PROGRAM_ID,
  HYPERSPACE_RESOLVER_PROGRAM_IDL,
  parseErrorCodes,
  translateAddress,
} from "@/utils";

import type { Address } from "@/utils";
import type { HyperspaceResolver } from "@idl/hyperspace_resolver";
import type { IdlTypes } from "@project-serum/anchor";

type ResolverTypes = IdlTypes<HyperspaceResolver>;

export type InitializeNftFloorParams = ResolverTypes["InitializeNftFloorParams"];
export type ResolveNftFloorParams = ResolverTypes["ResolveNftFloorParams"];

export const program = new Program(HYPERSPACE_RESOLVER_PROGRAM_IDL, HYPERSPACE_RESOLVER_PROGRAM_ID);
export const ErrorCode = parseErrorCodes(program.idl.errors);

/**
 * Gets the address of the nft floor resolver for a given market.
 */
export function getNftFloorAddress(market: Address): PublicKey {
  const [userPosition] = PublicKey.findProgramAddressSync(
    [Buffer.from("nft_floor"), translateAddress(market).toBuffer()],
    program.programId,
  );
  return userPosition;
}
