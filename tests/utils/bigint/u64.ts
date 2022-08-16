import BN, { isBN } from "bn.js";

export type IntoU64 = bigint | number | boolean | string | BN;

export class IntoU64Error extends TypeError {
  constructor(public value: IntoU64, msg?: string) {
    super(msg ?? `Cannot convert ${value} to u64`);
  }
}

export class U64RangeError extends IntoU64Error {
  constructor(value: IntoU64) {
    super(value, `${value} is not within the u64 range`);
  }
}

const U64_MIN = 0n;
const U64_MAX = 2n ** 64n - 1n;

const pool = new Uint8Array(8);
const poolView = new DataView(pool.buffer, pool.byteOffset, pool.byteLength);

function u64ToBN(n: bigint): BN {
  // Write the bigint to the pool in big-endian format.
  poolView.setBigUint64(0, n, false);
  // Converting from big endian should be faster here.
  return new BN(pool, "be");
}

/**
 * Converts a given value to an unsigned 64-bit `BN`.
 */
export function intoU64BN(n: IntoU64): BN {
  switch (typeof n) {
    case "bigint":
      // Check the value fits in a u64.
      if (n < U64_MIN || n > U64_MAX) {
        throw new U64RangeError(n);
      }

      return u64ToBN(n);

    case "number":
      // Check the value is an integer.
      if (!Number.isInteger(n)) {
        throw new IntoU64Error(n);
      }

      // Check the value fits in a u64.
      if (n < U64_MIN || n > U64_MAX) {
        throw new U64RangeError(n);
      }

      return new BN(n);

    case "boolean":
      return new BN(n ? 1 : 0);

    case "string":
      try {
        n = BigInt(n);
      } catch (e) {
        // The value isn't a valid bigint.
        throw new IntoU64Error(n);
      }

      // Check the value fits in a u64.
      if (n < U64_MIN || n > U64_MAX) {
        throw new U64RangeError(n);
      }

      return u64ToBN(n);

    default:
      if (isBN(n)) {
        return n;
      }

      // Should never occur, if type constraints are followed.
      throw new IntoU64Error(n);
  }
}

/**
 * Converts a given value to an unsigned 64-bit `bigint`.
 */
export function intoU64(n: IntoU64): bigint {
  switch (typeof n) {
    case "bigint":
      // Check the value fits in a u64.
      if (n < U64_MIN || n > U64_MAX) {
        throw new U64RangeError(n);
      }

      return n;

    case "number":
      // Check the value is an integer.
      if (!Number.isInteger(n)) {
        throw new IntoU64Error(n);
      }

      // Check the value fits in a u64.
      if (n < U64_MIN || n > U64_MAX) {
        throw new U64RangeError(n);
      }

      return BigInt(n);

    case "boolean":
      return BigInt(n);

    case "string":
      try {
        n = BigInt(n);
      } catch (e) {
        // The value isn't a valid bigint.
        throw new IntoU64Error(n);
      }

      // Check the value fits in a u64.
      if (n < U64_MIN || n > U64_MAX) {
        throw new U64RangeError(n);
      }

      return n;

    default:
      if (isBN(n)) {
        // Negative numbers are not valid for u64.
        if (n.isNeg()) {
          throw new U64RangeError(n);
        }

        // Pad the buffer to 8 bytes.
        const buf = n.toArrayLike(Buffer, "le", 8);
        if (buf.length !== 8) {
          // The value didn't fit in an 8 byte buffer.
          throw new U64RangeError(n);
        }

        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        return view.getBigUint64(0, true);
      }

      // Should never occur, if type constraints are followed.
      throw new IntoU64Error(n);
  }
}
