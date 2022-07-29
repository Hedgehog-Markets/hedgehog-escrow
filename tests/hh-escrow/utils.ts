import type { HhEscrow } from "../../target/types/hh_escrow";
import type { IdlTypes, Program } from "@project-serum/anchor";

import * as anchor from "@project-serum/anchor";

import { parseErrorCodes } from "../utils";

type EscrowTypes = IdlTypes<HhEscrow>;

export type InitializeMarketParams = EscrowTypes["InitializeMarketParams"];
export type UriResource = EscrowTypes["UriResource"];
export type DepositParams = EscrowTypes["DepositParams"];
export type UpdateStateParams = EscrowTypes["UpdateStateParams"];
export type Outcome = EscrowTypes["Outcome"];

export const program: Program<HhEscrow> = anchor.workspace.HhEscrow;

export const ErrorCode = parseErrorCodes(program.idl.errors);

/**
 * Interpret the on-chain representation of a `UriResource` as a string.
 */
export function interpretMarketResource({ len, uri }: UriResource): string {
  const buf = Buffer.from(uri).subarray(0, len);
  return buf.toString("utf8");
}
