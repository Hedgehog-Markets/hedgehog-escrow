// Use a hack to attempt to import Switchboard typings, which are written to
// disk after being fetched from on-chain. If TypeScript fails to find the file
// we ignore the error and fall back to using the generic Idl type.

/* eslint-disable import/order, @typescript-eslint/prefer-ts-expect-error, @typescript-eslint/ban-ts-comment */
// @ts-ignore
import type { SwitchboardV2 as IDL } from "@idl/switchboard_v2";
/* eslint-enable import/order, @typescript-eslint/prefer-ts-expect-error, @typescript-eslint/ban-ts-comment */

import type { Idl, Program } from "@project-serum/anchor";
import type { SwitchboardProgram as SbProgram } from "@switchboard-xyz/switchboard-v2";

export type SwitchboardV2 = unknown extends IDL ? Idl : IDL;
export type SwitchboardProgram = SbProgram & Program<SwitchboardV2>;
