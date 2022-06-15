/* eslint-disable @typescript-eslint/no-empty-interface */
import type { PublicKey } from '@solana/web3.js';
import type { IntoBigInt } from './utils';

interface CustomMatchers<R = unknown> {
  /**
   * Checks that a `PublicKey` is what you expect.
   */
  toEqualPubkey(expected: PublicKey): R;
  /**
   * Checks that a `BN` value is what you expect.
   */
  toEqualBN(expected: IntoBigInt): R;
  /**
   * Checks that specific `ProgramError` is thrown inside a function.
   */
  toThrowProgramError(code: number): R;
  /**
   * Checks that specific `AnchorError` is thrown inside a function.
   */
  toThrowAnchorError(code: number): R;
  /**
   * Checks that the balance of a token account is what you expect.
   */
  toHaveBalance(expected: IntoBigInt): Promise<R>;
}

declare global {
  namespace jest {
    interface Expect extends CustomMatchers {}
    interface Matchers<R> extends CustomMatchers<R> {}
    interface InverseAsymmetricMatchers extends CustomMatchers {}
  }
}
