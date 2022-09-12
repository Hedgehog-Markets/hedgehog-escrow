import type { HyperspaceResolver } from "../../target/types/hyperspace_resolver";
import type { IdlTypes } from "@project-serum/anchor";
import type { Address } from "../utils";

import { Program } from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";

import {
  HYPERSPACE_RESOLVER_PROGRAM_ID,
  HYPERSPACE_RESOLVER_PROGRAM_IDL,
  parseErrorCodes,
  translateAddress,
} from "../utils";

type ResolverTypes = IdlTypes<HyperspaceResolver>;

export type InitializeNftFloorParams =
  ResolverTypes["InitializeNftFloorParams"];
export type ResolveNftFloorParams = ResolverTypes["ResolveNftFloorParams"];

export const program = new Program(
  HYPERSPACE_RESOLVER_PROGRAM_IDL,
  HYPERSPACE_RESOLVER_PROGRAM_ID,
);
export const ErrorCode = parseErrorCodes(program.idl.errors);

/**
 * Gets the address of the user position account for a given user and market.
 */
export function getNftFloorAddress(market: Address): PublicKey {
  const [userPosition] = PublicKey.findProgramAddressSync(
    [Buffer.from("nft_floor"), translateAddress(market).toBuffer()],
    program.programId,
  );
  return userPosition;
}
