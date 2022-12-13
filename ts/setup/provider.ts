/* eslint-disable import/no-duplicates */

import "./env";

import { AnchorProvider, Wallet, setProvider } from "@project-serum/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import fs from "graceful-fs";

import { mapTxErr } from "@/utils/transaction";

import { RPC_URL, WALLET_FILE } from "./env";

import type { ConfirmOptions } from "@solana/web3.js";

const options: ConfirmOptions = {
  ...AnchorProvider.defaultOptions(),
  maxRetries: 10,
};

const connection = new Connection(RPC_URL, options.commitment);
const wallet = new Wallet(
  Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(WALLET_FILE, "utf-8")))),
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
