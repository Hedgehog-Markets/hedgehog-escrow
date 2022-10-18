import { Program } from "@project-serum/anchor";

import {
  SWITCHBOARD_RESOLVER_PROGRAM_ID,
  SWITCHBOARD_RESOLVER_PROGRAM_IDL,
  parseErrorCodes,
} from "@/utils";

export const program = new Program(
  SWITCHBOARD_RESOLVER_PROGRAM_IDL,
  SWITCHBOARD_RESOLVER_PROGRAM_ID,
);
export const ErrorCode = parseErrorCodes(program.idl.errors);
