import "@/setup/provider";

import path from "path";

export const PROJECT_DIR = path.dirname(path.dirname(__dirname));

export * from "./accounts";
export * from "./bigint";
export * from "./constants";
export * from "./idl";
export * from "./instructions";
export * from "./misc";
export * from "./spl";
export * from "./system";
export * from "./transaction";
export * from "./types";

export * as chain from "./chain";
export * as rpc from "./rpc";
