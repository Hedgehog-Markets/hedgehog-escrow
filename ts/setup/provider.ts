import path from "path";
import process from "process";

import { AnchorProvider, Wallet, setProvider } from "@project-serum/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import fs from "graceful-fs";

import { PROJECT_DIR, mapTxErr } from "@/utils";

import type { ConfirmOptions } from "@solana/web3.js";

const url = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
const walletFile = process.env.ANCHOR_WALLET ?? path.resolve(PROJECT_DIR, "test_wallet.json");

const options: ConfirmOptions = {
  ...AnchorProvider.defaultOptions(),
  maxRetries: 10,
};

const connection = new Connection(url, options.commitment);
const wallet = new Wallet(
  Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(walletFile, "utf-8")))),
);

const provider = new AnchorProvider(connection, wallet, options);

// Provider better transaction errors.
{
  const { sendAndConfirm, sendAll, simulate } = provider;

  provider.sendAndConfirm = function (...args) {
    return mapTxErr(sendAndConfirm.call(this, ...args));
  };
  provider.sendAll = function (...args) {
    return mapTxErr(sendAll.call(this, ...args));
  };
  provider.simulate = function (...args) {
    return mapTxErr(simulate.call(this, ...args));
  };

  const sendEncodedTransaction = connection.sendEncodedTransaction;

  connection.sendEncodedTransaction = function (...args) {
    return mapTxErr(sendEncodedTransaction.call(this, ...args));
  };
}

setProvider(provider);
