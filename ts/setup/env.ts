import path from "path";
import process from "process";

export const PROJECT_DIR = path.dirname(path.dirname(__dirname));

export const RPC_URL = (process.env.ANCHOR_PROVIDER_URL ??= "http://127.0.0.1:8899");
export const WALLET_FILE = (process.env.ANCHOR_WALLET ??= path.resolve(
  PROJECT_DIR,
  "test_wallet.json",
));
