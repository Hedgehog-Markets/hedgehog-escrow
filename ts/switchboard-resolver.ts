import { Program } from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";

import {
  SWITCHBOARD_RESOLVER_PROGRAM_ID,
  SWITCHBOARD_RESOLVER_PROGRAM_IDL,
  parseErrorCodes,
  translateAddress,
} from "@/utils";

import type { Address } from "@/utils";

export const program = new Program(
  SWITCHBOARD_RESOLVER_PROGRAM_IDL,
  SWITCHBOARD_RESOLVER_PROGRAM_ID,
);
export const ErrorCode = parseErrorCodes(program.idl.errors);

/**
 * Gets the address of the resolver for the given market.
 */
export function getResolverAddress(market: Address): PublicKey {
  const [userPosition] = PublicKey.findProgramAddressSync(
    [Buffer.from("resolver"), translateAddress(market).toBuffer()],
    program.programId,
  );
  return userPosition;
}
