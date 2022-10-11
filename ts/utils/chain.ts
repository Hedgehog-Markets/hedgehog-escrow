import { getProvider } from "@project-serum/anchor";

import { __throw, sleep } from "./misc";

/**
 * Attempts to get the current on-chain unix timestamp.
 */
export async function blockTimestamp(): Promise<number> {
  const provider = getProvider();

  const { absoluteSlot } = await provider.connection.getEpochInfo();
  const time = await provider.connection.getBlockTime(absoluteSlot + 1);

  return time ?? __throw(new Error("Failed to get block time"));
}

/**
 * Attempts to sleep until the given timestamp is reached on chain.
 */
export async function sleepUntil(ts: number, timeoutMs: number = 5_000): Promise<void> {
  let timedOut = false;

  const timeout = sleep(timeoutMs).then(() => {
    timedOut = true;
    throw new Error("Timeout out waiting for clock progression");
  });

  const wait = (async () => {
    while (!timedOut) {
      await sleep(100);

      const time = await blockTimestamp();
      if (ts <= time) {
        return;
      }
    }

    throw new Error("Timeout out waiting for clock progression");
  })();

  await Promise.race([wait, timeout]);
}
