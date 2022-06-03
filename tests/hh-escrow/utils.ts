import * as anchor from '@project-serum/anchor';
import type { IdlTypes, Program } from '@project-serum/anchor';
import type { HhEscrow } from '../../target/types/hh_escrow';
import { parseErrorCodes } from '../utils';

type EscrowTypes = IdlTypes<HhEscrow>;

export type InitializeMarketParams = EscrowTypes['InitializeMarketParams'];
export type UriResource = EscrowTypes['UriResource'];
export type DepositParams = EscrowTypes['DepositParams'];
export const program: Program<HhEscrow> =
  anchor.workspace.HhEscrow;

export const ErrorCode = parseErrorCodes(program.idl.errors);

export function interpretMarketResource({ len, uri }: UriResource): String {
  const buf = Buffer.from(uri).subarray(0, len);
  return buf.toString('utf8');
}
