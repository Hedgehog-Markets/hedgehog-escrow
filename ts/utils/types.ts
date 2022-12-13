export type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

export type ExpandRecursively<T> = T extends infer O extends Record<PropertyKey, unknown>
  ? { [K in keyof O]: ExpandRecursively<O[K]> }
  : T;

export type DeepPartial<T> = T extends Record<PropertyKey, unknown>
  ? {
      [P in keyof T]?: DeepPartial<T[P]> | undefined;
    }
  : T;

type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

export type Xor<T extends Array<unknown>> = T extends [infer Only]
  ? Only
  : T extends [infer A, infer B, ...infer Rest]
  ? Xor<[A | B extends unknown ? (Without<A, B> & B) | (Without<B, A> & A) : A | B, ...Rest]>
  : never;

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
