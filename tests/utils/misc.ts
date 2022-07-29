/**
 * Sleep for a given number of milliseconds.
 *
 * @param ms The number of milliseconds to sleep.
 *
 * @returns A promise that resolves after the given number of milliseconds.
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Gets the current unix timestamp.
 */
export const timestamp = (): bigint => BigInt(Date.now()) / 1000n;
