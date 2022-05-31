/* eslint-disable @typescript-eslint/no-empty-interface */
import type { PublicKey } from '@solana/web3.js';

interface CustomMatchers<R = unknown> {
  /**
   * Checks that a `PublicKey` is what you expect.
   */
  toEqualPubkey(expected: PublicKey): R;
  /**
   * Checks that specific `ProgramError` is thrown inside a function.
   */
  toThrowProgramError(code: number): R;
}

declare global {
  namespace jest {
    interface Expect extends CustomMatchers {}
    interface Matchers<R> extends CustomMatchers<R> {}
    interface InverseAsymmetricMatchers extends CustomMatchers {}
  }
}
