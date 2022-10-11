import { fromBytesLE, toBytesBE } from "bigint-utils";
import BN, { isBN } from "bn.js";

export type IntoBigInt = bigint | number | boolean | string | BN;

export class IntoBigIntError extends TypeError {
  constructor(public value: IntoBigInt) {
    super(`Cannot convert ${value} to big integer`);
  }
}

function bigIntToBN(n: bigint): BN {
  const buf = toBytesBE(n);
  // Converting from big endian should be faster here.
  const bn = new BN(buf, "be");
  return n < 0 ? bn.ineg() : bn;
}

/**
 * Converts a given value to a `BN`.
 */
export function intoBN(n: IntoBigInt): BN {
  switch (typeof n) {
    case "bigint":
      return bigIntToBN(n);

    case "number":
      // Check the value is an integer.
      if (!Number.isInteger(n)) {
        throw new IntoBigIntError(n);
      }

      return new BN(n);

    case "boolean":
      return new BN(n ? 1 : 0);

    case "string":
      try {
        n = BigInt(n);
      } catch (e) {
        // The value isn't a valid bigint.
        throw new IntoBigIntError(n);
      }
      return bigIntToBN(n);

    default:
      if (isBN(n)) {
        return n;
      }

      // Should never occur, if type constraints are followed.
      throw new IntoBigIntError(n);
  }
}

/**
 * Converts a given value to a `bigint`.
 */
export function intoBigInt(n: IntoBigInt): bigint {
  switch (typeof n) {
    case "bigint":
      return n;

    case "number":
      // Check the value is an integer.
      if (!Number.isInteger(n)) {
        throw new IntoBigIntError(n);
      }

      return BigInt(n);

    case "boolean":
      return BigInt(n);

    case "string":
      try {
        n = BigInt(n);
      } catch (e) {
        // The value isn't a valid bigint.
        throw new IntoBigIntError(n);
      }
      return n;

    default:
      if (isBN(n)) {
        // By using a minimal buffer size of 8, we hit the fast path more.
        const buf = n.toArrayLike(Buffer, "le", 8);
        // Converting from little endian should be faster with native module.
        return fromBytesLE(buf);
      }

      // Should never occur, if type constraints are followed.
      throw new IntoBigIntError(n);
  }
}
