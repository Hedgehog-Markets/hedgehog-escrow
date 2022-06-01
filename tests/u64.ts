// TODO: Move these utils into a public common repo/package.
// Taken from Hedgehog/hedgehog-programs.
import BN, { isBN } from "bn.js";

export type u64 = bigint;
export type IntoU64 = bigint | number | boolean | string | BN;

export class IntoU64Error extends TypeError {
  constructor(public value: IntoU64) {
    super("invalid value for conversion to u64");
    this.value = value;
  }
}
export class U64RangeError extends TypeError {
  constructor(public value: IntoU64) {
    super(`value '${value}' is not within the u64 range`);
    this.value = value;
  }
}

const U64_MIN = 0n;
const U64_MAX = 2n ** 64n - 1n;

export function intoU64(n: IntoU64): u64 {
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

        // Check the value fits in a u64.
        if (n < U64_MIN || n > U64_MAX) {
          throw new U64RangeError(n);
        }

        return n;
      } catch (e) {
        // The value isn't a valid bigint.
        throw new IntoU64Error(n);
      }

    default:
      if (isBN(n)) {
        // Negative numbers are not valid for u64.
        if (n.isNeg()) {
          throw new U64RangeError(n);
        }

        try {
          // Try to convert to little-endian buffer.
          const buffer = n.toBuffer("le", 8);
          // Read a little-endian u64 from the buffer.
          return buffer.readBigUInt64LE();
        } catch (e) {
          // The value didn't fit in an 8 byte buffer.
          throw new U64RangeError(n);
        }
      }

      // Should never occur, if type constraints are followed.
      throw new IntoU64Error(n);
  }
}

function u64ToBN(n: u64): BN {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(n);
  return new BN(buffer, "le");
}

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

        // Check the value fits in a u64.
        if (n < U64_MIN || n > U64_MAX) {
          throw new U64RangeError(n);
        }

        return u64ToBN(n);
      } catch (e) {
        // The value isn't a valid bigint.
        throw new IntoU64Error(n);
      }

    default:
      if (isBN(n)) {
        // Number cannot be negative and must fit within 8 bytes.
        if (n.isNeg() || n.byteLength() > 8) {
          throw new U64RangeError(n);
        }

        return n;
      }

      // Should never occur, if type constraints are followed.
      throw new IntoU64Error(n);
  }
}
