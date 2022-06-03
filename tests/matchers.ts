import { PublicKey } from '@solana/web3.js';
import { isError } from '@jest/expect-utils';
import { formatStackTrace, separateMessageFromStack } from 'jest-message-util';
import { isPrimitive } from 'jest-get-type';
import { AnchorError, ProgramError } from '@project-serum/anchor';
import { IntoBigInt, intoBN } from './utils';
import { BN, isBN } from 'bn.js';

type Constructor = new (...args: never) => unknown;

expect.extend({
  toEqualPubkey(received: unknown, expected: PublicKey) {
    const matcherName = 'toEqualPubkey';
    const options = {
      isNot: this.isNot,
      promise: this.promise,
    };

    if (!(received instanceof PublicKey)) {
      return {
        pass: false,
        message: () =>
          this.utils.matcherHint(matcherName, undefined, undefined, options) +
          '\n\n' +
          printExpectedConstructorName(this, PublicKey) +
          printReceivedInfo(this, received),
      };
    }

    const pass = expected.equals(received);
    const message = pass
      ? () =>
          this.utils.matcherHint(matcherName, undefined, undefined, options) +
          `\n\nExpected: ${this.utils.EXPECTED_COLOR(expected.toBase58())}`
      : () =>
          this.utils.matcherHint(matcherName, undefined, undefined, options) +
          `\n\nExpected: ${this.utils.EXPECTED_COLOR(
            expected.toBase58()
          )}\nReceived: ${this.utils.RECEIVED_COLOR(received.toBase58())}`;

    return { pass, message };
  },

  toEqualBN(received: unknown, expected: IntoBigInt) {
    const matcherName = 'toEqualBN';

    const options = {
      isNot: this.isNot,
      promise: this.promise,
    };

    expected = intoBN(expected);

    if (!isBN(received)) {
      return {
        pass: false,
        message: () =>
          this.utils.matcherHint(matcherName, undefined, undefined, options) +
          '\n\n' +
          printExpectedConstructorName(this, BN) +
          printReceivedInfo(this, received),
      };
    }

    const pass = expected.eq(received);
    const message = pass
      ? () =>
          this.utils.matcherHint(matcherName, undefined, undefined, options) +
          `\n\nExpected: ${this.utils.EXPECTED_COLOR(expected)}`
      : () =>
          this.utils.matcherHint(matcherName, undefined, undefined, options) +
          `\n\nExpected: ${this.utils.EXPECTED_COLOR(
            expected
          )}\nReceived: ${this.utils.RECEIVED_COLOR(received)}`;

    return { pass, message };
  },

  // This runs through the same logic as ProgramError, with a slight pathing
  // difference to locate the error code. We may want to consolidate the logic
  // of these to matchers in the future.
  toThrowAnchorError(received: unknown, code: number) {
    const matcherName = 'toThrowAnchorError';
    const options = {
      isNot: this.isNot,
      promise: this.promise,
    };

    let thrown: Thrown | null = null;

    if (this.promise && isError(received)) {
      thrown = getThrown(received);
    } else if (typeof received !== 'function') {
      throw new Error(
        this.utils.matcherErrorMessage(
          this.utils.matcherHint(matcherName, undefined, undefined, options),
          `${this.utils.RECEIVED_COLOR('received')} value must be a function`,
          this.utils.printWithType(
            'Received',
            received,
            this.utils.printReceived
          )
        )
      );
    } else {
      try {
        received();
      } catch (e) {
        thrown = getThrown(e);
      }
    }

    if (thrown === null || !(thrown.value instanceof AnchorError)) {
      return {
        pass: false,
        message: () =>
          this.utils.matcherHint(matcherName, undefined, undefined, options) +
          '\n\n' +
          printExpectedConstructorName(this, AnchorError) +
          (thrown === null
            ? '\nReceived function did not throw'
            : `${
                typeof thrown.value != null &&
                typeof (thrown.value as { constructor?: unknown })
                  .constructor === 'function'
                  ? printReceivedConstructorName(
                      this,
                      (thrown.value as { constructor: Constructor }).constructor
                    )
                  : ''
              }\n${
                thrown.hasMessage
                  ? `Received message: ${this.utils.printReceived(
                      thrown.message
                    )}` + formatStack(thrown)
                  : `Received value: ${this.utils.printReceived(thrown.value)}`
              }`),
      };
    }

    const receivedCode = thrown.value.error.errorCode.number;

    const pass = receivedCode === code;
    const message = pass
      ? () =>
          this.utils.matcherHint(matcherName, undefined, undefined, options) +
          '\n\n' +
          `Expected error code to not be ${this.utils.printExpected(code)}`
      : () =>
          this.utils.matcherHint(matcherName, undefined, undefined, options) +
          '\n\n' +
          this.utils.printDiffOrStringify(
            code,
            receivedCode,
            'Expected error code',
            'Received error code',
            this.expand !== false
          );

    return { pass, message };
  },

  toThrowProgramError(received: unknown, code: number) {
    const matcherName = 'toThrowProgramError';
    const options = {
      isNot: this.isNot,
      promise: this.promise,
    };

    let thrown: Thrown | null = null;

    if (this.promise && isError(received)) {
      thrown = getThrown(received);
    } else if (typeof received !== 'function') {
      throw new Error(
        this.utils.matcherErrorMessage(
          this.utils.matcherHint(matcherName, undefined, undefined, options),
          `${this.utils.RECEIVED_COLOR('received')} value must be a function`,
          this.utils.printWithType(
            'Received',
            received,
            this.utils.printReceived
          )
        )
      );
    } else {
      try {
        received();
      } catch (e) {
        thrown = getThrown(e);
      }
    }

    if (thrown === null || !(thrown.value instanceof ProgramError)) {
      return {
        pass: false,
        message: () =>
          this.utils.matcherHint(matcherName, undefined, undefined, options) +
          '\n\n' +
          printExpectedConstructorName(this, ProgramError) +
          (thrown === null
            ? '\nReceived function did not throw'
            : `${
                typeof thrown.value != null &&
                typeof (thrown.value as { constructor?: unknown })
                  .constructor === 'function'
                  ? printReceivedConstructorName(
                      this,
                      (thrown.value as { constructor: Constructor }).constructor
                    )
                  : ''
              }\n${
                thrown.hasMessage
                  ? `Received message: ${this.utils.printReceived(
                      thrown.message
                    )}` + formatStack(thrown)
                  : `Received value: ${this.utils.printReceived(thrown.value)}`
              }`),
      };
    }

    const receivedCode = thrown.value.code;

    const pass = receivedCode === code;
    const message = pass
      ? () =>
          this.utils.matcherHint(matcherName, undefined, undefined, options) +
          '\n\n' +
          `Expected error code to not be ${this.utils.printExpected(code)}`
      : () =>
          this.utils.matcherHint(matcherName, undefined, undefined, options) +
          '\n\n' +
          this.utils.printDiffOrStringify(
            code,
            receivedCode,
            'Expected error code',
            'Received error code',
            this.expand !== false
          );

    return { pass, message };
  },
});

type Thrown =
  | {
      hasMessage: true;
      isError: true;
      message: string;
      value: Error & { stack: string };
    }
  | {
      hasMessage: boolean;
      isError: false;
      message: string;
      value: unknown;
    };

const getThrown = (e: unknown): Thrown => {
  const hasMessage =
    e !== null &&
    e !== undefined &&
    typeof (e as { message?: unknown }).message === 'string';

  if (
    hasMessage &&
    typeof (e as { name?: unknown }).name === 'string' &&
    typeof (e as { stack?: unknown }).stack === 'string'
  ) {
    return {
      hasMessage,
      isError: true,
      message: (e as { message: string }).message,
      value: e as Error & { stack: string },
    };
  }

  return {
    hasMessage,
    isError: false,
    message: hasMessage ? (e as { message: string }).message : String(e),
    value: e,
  };
};

const printReceivedInfo = (ctx: jest.MatcherContext, received: unknown) =>
  isPrimitive(received) || Object.getPrototypeOf(received) === null
    ? `\nReceived value has no prototype\nReceived value: ${ctx.utils.printReceived(
        received
      )}`
    : typeof (received as { constructor?: unknown }).constructor !== 'function'
    ? `\nReceived value: ${ctx.utils.printReceived(received)}`
    : printReceivedConstructorName(
        ctx,
        (received as { constructor: Constructor }).constructor
      );

const printExpectedConstructorName = (
  ctx: jest.MatcherContext,
  constructor: Constructor
) => printConstructorName(ctx, 'Expected constructor', constructor, true);

const printReceivedConstructorName = (
  ctx: jest.MatcherContext,
  constructor: Constructor
) => printConstructorName(ctx, 'Received constructor', constructor, false);

const printConstructorName = (
  ctx: jest.MatcherContext,
  label: string,
  constructor: Constructor,
  isExpected: boolean
) =>
  `${label}: ${
    isExpected
      ? ctx.utils.EXPECTED_COLOR(constructor.name)
      : ctx.utils.RECEIVED_COLOR(constructor.name)
  }\n`;

const formatStack = (thrown: Thrown) =>
  !thrown.isError
    ? ''
    : formatStackTrace(
        separateMessageFromStack(thrown.value.stack).stack,
        {
          rootDir: process.cwd(),
          testMatch: [],
        },
        {
          noStackTrace: false,
        }
      );
