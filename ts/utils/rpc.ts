import { randomUUID } from "crypto";

import { BigDecimal } from "@juici/math";
import { getProvider } from "@project-serum/anchor";
import { SolanaJSONRPCError } from "@solana/web3.js";
import { fetch } from "cross-fetch";
import { parse as parseJson } from "lossless-json";
import {
  any,
  bigint,
  coerce,
  create,
  literal,
  optional,
  type as pick,
  string,
  union,
  unknown,
} from "superstruct";

import { sleep } from "./misc";

import type { Commitment, Connection, PublicKey } from "@solana/web3.js";
import type { Struct } from "superstruct";

/**
 * Extra contextual information for RPC responses
 */
export type Context = {
  slot: bigint;
};

/**
 * RPC Response with extra contextual information
 */
export type RpcResponseAndContext<T> = {
  /** response context */
  context: Context;
  /** response value */
  value: T;
};

/**
 * Fetches the balance in lamports for the specified public key, returned with context.
 */
export async function getBalanceAndContext(
  account: PublicKey,
  commitment?: Commitment,
): Promise<RpcResponseAndContext<bigint>> {
  const unsafeRes = await rpcRequest("getBalance", (connection) =>
    connection._buildArgs([account.toBase58()], commitment),
  );
  const res = create(unsafeRes, jsonRpcResultAndContext(bigint()));

  if ("error" in res) {
    throw new SolanaJSONRPCError(
      res.error,
      `Failed to get balance of account ${account.toBase58()}`,
    );
  }
  return res.result;
}

/**
 * Fetches the balance in lamports for the specified public key.
 */
export async function getBalance(account: PublicKey, commitment?: Commitment): Promise<bigint> {
  try {
    const result = await getBalanceAndContext(account, commitment);
    return result.value;
  } catch (err) {
    throw new Error(`Failed to get balance of account ${account.toBase58()}`, { cause: err });
  }
}

async function rpcRequest(
  method: string,
  args: Array<unknown> | ((connection: Connection) => Array<unknown>),
): Promise<unknown> {
  const connection = getProvider().connection;

  if (typeof args === "function") {
    args = args(connection);
  }

  const url = connection.rpcEndpoint;
  const options: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method,
      params: args,
    }),
  };

  let res: Response;
  let retries = 5;
  let delay = 500;

  for (;;) {
    res = await fetch(url, options);

    // If the status is not "Too Many Requests", then return it.
    if (res.status !== 429) {
      break;
    }
    if (--retries === 0) {
      break;
    }

    await sleep(delay);
    delay *= 2;
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return parseJson(text, undefined, parseNumber);
}

function parseNumber(value: string): bigint | BigDecimal {
  const v = new BigDecimal(value);
  return v.isInt() ? v.toBigInt() : v;
}

function createRpcResult<T, U>(result: Struct<T, U>) {
  return union([
    pick({
      jsonrpc: literal("2.0"),
      id: string(),
      result,
    }),
    pick({
      jsonrpc: literal("2.0"),
      id: string(),
      error: pick({
        code: unknown(),
        message: string(),
        data: optional(any()),
      }),
    }),
  ]);
}

const UnknownRpcResult = createRpcResult(unknown());

function jsonRpcResult<T, U>(schema: Struct<T, U>) {
  return coerce(createRpcResult(schema), UnknownRpcResult, (value) => {
    if ("error" in value) {
      return value;
    } else {
      return {
        ...value,
        result: create(value.result, schema),
      };
    }
  });
}

function jsonRpcResultAndContext<T, U>(value: Struct<T, U>) {
  return jsonRpcResult(
    pick({
      context: pick({
        slot: bigint(),
      }),
      value,
    }),
  );
}
