import { Program, getProvider } from "@project-serum/anchor";
import { SBV2_DEVNET_PID } from "@switchboard-xyz/switchboard-v2";

import { __throw } from "@/utils";

import type { SwitchboardProgram } from "@switchboard-xyz/switchboard-v2";

export const fetchProgram = (async () => {
  const provider = getProvider();
  const idl =
    (await Program.fetchIdl(SBV2_DEVNET_PID, provider)) ??
    __throw(new Error("Failed to fetch Switchboard IDL"));

  // Remove bugged `Error` type.
  if (idl.types) {
    const errorIdx = idl.types.findIndex((t) => t.name === "Error");
    if (errorIdx !== -1) {
      idl.types.splice(errorIdx, 1);
    } else {
      console.warn("Bugged Switchboard IDL `Error` type doesn't exist");
    }
  }

  return new Program(idl, SBV2_DEVNET_PID, provider) as SwitchboardProgram;
})();
