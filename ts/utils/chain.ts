import { getProvider } from "@project-serum/anchor";

import { __throw, sleep } from "./misc";

import type { Connection } from "@solana/web3.js";

/**
 * Attempts to get the current on-chain unix timestamp.
 */
export async function blockTimestamp(connection?: Connection): Promise<number> {
  connection ??= getProvider().connection;

  const slot = await connection.getSlot("confirmed");
  const time = await connection.getBlockTime(slot);

  return time ?? __throw(new Error("Failed to get block time"));
}

/**
 * Attempts to sleep until the given timestamp is reached on chain.
 */
export async function sleepUntil(ts: number, bufferMs: number = 5_000): Promise<void> {
  let timedOut = false;

  const expectedWait = ts - Math.floor(Date.now() / 1000);
  const timeoutMs = expectedWait + bufferMs;

  if (bufferMs <= 0) {
    throw new Error("Timeout out waiting for clock progression");
  }

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
