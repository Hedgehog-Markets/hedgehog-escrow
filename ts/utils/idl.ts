import type { Idl } from "@project-serum/anchor";

export type IdlErrorCode = NonNullable<Idl["errors"]>[number];

export type ParseErrorCode<E extends Array<IdlErrorCode>> = {
  [K in E[number]["name"]]: (E[number] & { name: K })["code"];
};

/**
 * Parse IDL error codes into a map of error names to error codes.
 */
export function parseErrorCodes<E extends Array<IdlErrorCode>>(
  errors: E,
): Readonly<ParseErrorCode<E>> {
  const map = {} as ParseErrorCode<E>;
  for (const { name, code } of errors) {
    map[name as keyof ParseErrorCode<E>] = code;
  }
  return Object.freeze(map);
}
