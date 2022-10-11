import type { Idl } from "@project-serum/anchor";

export type IdlErrorCode = NonNullable<Idl["errors"]>[number];

type ErrorCode<E extends Array<IdlErrorCode>> = {
  [K in E[number]["name"]]: (E[number] & { name: K })["code"];
};

/**
 * Parse IDL error codes into a map of error names to error codes.
 */
export function parseErrorCodes<E extends Array<IdlErrorCode>>(errors: E): Readonly<ErrorCode<E>> {
  const map = {} as ErrorCode<E>;
  for (const { name, code } of errors) {
    map[name as keyof ErrorCode<E>] = code;
  }
  return Object.freeze(map);
}
