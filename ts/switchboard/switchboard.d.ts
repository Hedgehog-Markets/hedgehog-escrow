// Use a hack to attempt to import Switchboard typings, which are written to
// disk after being fetched from on-chain. If TypeScript fails to find the file
// we ignore the error and fall back to using the generic Idl type.

// eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error, @typescript-eslint/ban-ts-comment
// @ts-ignore
import type { SwitchboardV2 } from "@idl/switchboard_v2";
import type { Idl, Program } from "@project-serum/anchor";

import "@switchboard-xyz/switchboard-v2";

type IDL = unknown extends SwitchboardV2 ? Idl : SwitchboardV2;

declare module "@switchboard-xyz/switchboard-v2" {
  // @ts-expect-error: TypeScript will complain about a duplicate type identifier;
  // this is unavoidable since module augmentation doesn't play nicely with 'type'.
  // Luckily TypeScript will tend to prefer our type here when resolving the conflict.
  export type SwitchboardProgram = Program<IDL>;
}
