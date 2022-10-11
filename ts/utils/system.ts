import { Native } from "@project-serum/anchor";

import { parseErrorCodes } from "./idl";

export const system = Native.system();

export const SystemErrorCode = parseErrorCodes(system.idl.errors);
