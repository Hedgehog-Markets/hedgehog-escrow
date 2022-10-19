class Optional<T> {
  constructor(public readonly value?: T) {}

  public apply<U>(f: (value: T) => U): Optional<U> {
    if (this.value === null || this.value === undefined) {
      return new Optional<U>();
    }
    return new Optional(f(this.value));
  }
}

/**
 * Wrap a value to facilitate optional chaining.
 */
export const opt = <T>(value?: T): Optional<T> => new Optional(value);

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
export const unixTimestamp = (): bigint => BigInt(Date.now()) / 1000n;

/**
 * Converts the given data to a Buffer.
 */
export function toBuffer(data: Buffer | Uint8Array | ReadonlyArray<number>): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  } else if (data instanceof Uint8Array) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  } else {
    return Buffer.from(data);
  }
}

/**
 * Utility function to throw from an expression.
 */
export function __throw(error: Error): never {
  throw error;
}
