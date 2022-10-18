import { fetchProgram as fetchSwitchboard } from "@/switchboard";
import { program } from "@/switchboard-resolver";

import type { SwitchboardProgram } from "@switchboard-xyz/switchboard-v2";

describe("initialize switchboard resolver", () => {
  let switchboard: SwitchboardProgram;

  beforeAll(async () => {
    // Fix tuple variant type issue.
    switchboard = await fetchSwitchboard;
  });

  it("test switchboard", async () => {});
});
