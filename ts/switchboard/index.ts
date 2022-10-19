import path from "path";

import { Program, getProvider } from "@project-serum/anchor";
import { SBV2_DEVNET_PID } from "@switchboard-xyz/switchboard-v2";
import fs from "graceful-fs";

import { PROJECT_DIR, __throw } from "@/utils";

import type { Idl } from "@project-serum/anchor";
import type { SwitchboardProgram } from "@switchboard-xyz/switchboard-v2";

type SwitchboardV2 = SwitchboardProgram extends Program<infer IDL> ? IDL : never;
type IdlTypeDef = NonNullable<Idl["types"]>[number];

export const loadSwitchboardProgram = (async () => {
  const provider = getProvider();
  const idl =
    (await Program.fetchIdl<SwitchboardV2>(SBV2_DEVNET_PID, provider)) ??
    __throw(new Error("Failed to fetch Switchboard IDL"));

  // Attempt to remove bugged `Error` type.
  if (idl.types) {
    let bugged = false;

    const errorIdx = idl.types.findIndex((t) => t.name === ("Error" as never));
    if (errorIdx !== -1) {
      const { type } = idl.types[errorIdx] as IdlTypeDef;
      // We found the `Error` type, check if it is bugged.
      if (
        type.kind === "enum" &&
        type.variants.some(
          (v) => v.fields?.some((f) => typeof f !== "object" || !("name" in f)) ?? false,
        )
      ) {
        // Remove bugged type.
        idl.types.splice(errorIdx, 1);
        bugged = true;
      }
    }

    // If the bugged `Error` type can't be found, print a warning.
    if (!bugged) {
      console.warn("Bugged Switchboard IDL `Error` type doesn't exist");
    }
  }

  const json = JSON.stringify(idl, null, 2);
  const types = `export type SwitchboardV2 = ${json};\n\nexport const IDL: SwitchboardV2 = ${json};\n`;

  await fs.promises.writeFile(
    path.resolve(PROJECT_DIR, "target/types/switchboard_v2.ts"),
    types,
    "utf-8",
  );

  return new Program(idl, SBV2_DEVNET_PID, provider) as unknown as SwitchboardProgram;
})();
