import { spawnSync } from "child_process";
import { createHash } from "crypto";
import path from "path";
import process from "process";

import { BorshAccountsCoder } from "@project-serum/anchor";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { SBV2_DEVNET_PID } from "@switchboard-xyz/switchboard-v2";
import fs from "graceful-fs";
import pako from "pako";
import toml from "toml";

export const PROJECT_DIR = path.dirname(__dirname);
export const PROGRAMS_DIR = path.join(PROJECT_DIR, "programs");
export const DEPLOY_DIR = path.join(PROJECT_DIR, "target", "deploy");
export const IDL_DIR = path.join(PROJECT_DIR, "target", "idl");
export const ACCOUNTS_DIR = path.join(DEPLOY_DIR, "accounts");

export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

// https://github.com/solana-labs/solana/blob/aea84e699c904235b8d6406b9424c22449e8254f/sdk/program/src/rent.rs#L31
export const LAMPORTS_PER_BYTE_YEAR = Number(((1_000_000_000n / 100n) * 365n) / (1024n * 1024n));

////////////////////////////////////////////////////////////////////////////////

type AnchorToml = {
  programs?: { localnet?: { [program: string]: string } };
  provider?: { wallet?: string };
  test?: {
    genesis?: [{ address: string; program: string }];
    validator?: {
      url?: string;
      account?: [{ address: string; filename: string }];
      clone?: [{ address: string }];
    };
  };
};

export const anchorToml: AnchorToml = (() => {
  const file = path.join(PROJECT_DIR, "Anchor.toml");
  try {
    const data = fs.readFileSync(file, "utf8");
    return toml.parse(data);
  } catch (e) {
    console.error(`error: could not read Anchor config file '${file}'`);
    process.exit(1);
  }
})();

export const walletPath = path.join(
  PROJECT_DIR,
  anchorToml?.provider?.wallet ?? __throw(new Error("missing provider wallet")),
);
export const wallet = readKeypair(walletPath);

////////////////////////////////////////////////////////////////////////////////

const IDL_ACCOUNT_DISCRIMINATOR = BorshAccountsCoder.accountDiscriminator("IdlAccount");

export function getExecutableAddress(program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [program.toBytes()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  )[0];
}

export function getIdlAccountAddress(program: PublicKey): PublicKey {
  const [signer] = PublicKey.findProgramAddressSync([], program);
  const buf = Buffer.concat([signer.toBytes(), Buffer.from("anchor:idl"), program.toBytes()]);
  return new PublicKey(createHash("sha256").update(buf).digest());
}

export class Program {
  readonly address: PublicKey;
  readonly exeAddress: PublicKey;
  readonly idlAddress: PublicKey;

  readonly accountPath: string;
  readonly exeAccountPath: string;
  readonly idlAccountPath: string;

  constructor(readonly name: string, readonly lib: string) {
    this.address = new PublicKey(
      anchorToml.programs?.localnet?.[lib] ??
        __throw(new Error(`missing [program.localnet] entry for '${lib}'`)),
    );
    this.exeAddress = getExecutableAddress(this.address);
    this.idlAddress = getIdlAccountAddress(this.address);

    this.accountPath = path.join(ACCOUNTS_DIR, `${lib}.json`);
    this.exeAccountPath = path.join(ACCOUNTS_DIR, `${lib}-exe.json`);
    this.idlAccountPath = path.join(ACCOUNTS_DIR, `${lib}-idl.json`);
  }

  public toString(): string {
    return this.name;
  }

  public async elf(): Promise<Uint8Array> {
    return fs.promises.readFile(path.join(DEPLOY_DIR, `${this.lib}.so`));
  }

  public async idl(): Promise<Uint8Array> {
    const idl = await fs.promises.readFile(path.join(IDL_DIR, `${this.lib}.json`));
    return pako.deflate(idl);
  }
}

export const programs = (() => {
  const programs = new Map<string, Program>();

  let entries: Array<fs.Dirent>;
  try {
    entries = fs.readdirSync(PROGRAMS_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`error: could not read programs directory '${PROGRAMS_DIR}'`);
    process.exit(1);
  }

  const programNames = new Set<string>();
  for (const entry of entries) {
    if (entry.isDirectory()) {
      programNames.add(entry.name);
    }
  }

  const result = spawnSync("cargo", ["metadata"], {
    shell: false,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(`error: failed to fetch workspace metadata`);
    process.exit(1);
  }

  const metadata = JSON.parse(result.stdout);
  const packages =
    metadata?.packages ?? __throw(new Error("missing 'packages' entry in workspace metadata"));

  if (!Array.isArray(packages)) {
    throw new Error("'packages' entry in workspace metadata is not an array");
  }

  for (const pkg of packages) {
    const name = pkg.name ?? __throw(new Error("missing package name"));
    if (programNames.delete(name)) {
      const lib = pkg.targets?.[0]?.name ?? __throw(new Error("missing package target name"));

      const program = new Program(name, lib);
      programs.set(name, program);
    }
  }

  return programs;
})();

////////////////////////////////////////////////////////////////////////////////

let exitHandlers: Array<() => void> | undefined;

function exitHandler() {
  if (exitHandlers === undefined) {
    return;
  }

  // Take ownership of the exit handlers.
  const handlers = exitHandlers;
  exitHandlers = undefined;

  let callback;
  while ((callback = handlers.pop()) !== undefined) {
    callback();
  }
}

/**
 * Add a handler to be called on process exit.
 */
export function atexit(fn: () => void): void {
  if (exitHandlers === undefined) {
    exitHandlers = [];

    process.once("SIGINT", exitHandler);
    process.once("SIGHUP", exitHandler);
    process.once("SIGQUIT", exitHandler);
    process.once("SIGTERM", exitHandler);
    process.once("uncaughtException", exitHandler);
    process.once("exit", exitHandler);
    process.once("beforeExit", exitHandler);
  }

  exitHandlers.push(fn);
}

////////////////////////////////////////////////////////////////////////////////

const getAccountJson = ({
  pubkey,
  account: { lamports, data, owner, executable, rentEpoch },
}: {
  pubkey: PublicKey | string;
  account: {
    lamports?: number;
    data: Buffer;
    owner: PublicKey | string;
    executable: boolean;
    rentEpoch?: number;
  };
}): string =>
  JSON.stringify({
    pubkey,
    account: {
      lamports: lamports ?? minLamportsForRentExempt(data.length),
      data: [data.toString("base64"), "base64"],
      owner,
      executable,
      rentEpoch: rentEpoch ?? 0,
    },
  });

const createAccountsDir = () => fs.promises.mkdir(ACCOUNTS_DIR, { recursive: true });

/**
 * Build a program.
 */
export async function build(program: Program, verbose: boolean = false): Promise<void> {
  console.log(`Building ${program}`);

  const args: Array<string> = ["build"];
  args.push("--program-name", program.lib); // Build lib.

  const result = spawnSync("anchor", args, {
    shell: false,
    stdio: ["ignore", verbose ? "inherit" : "ignore", "inherit"],
  });
  if (result.status !== 0) {
    console.error(`error: failed to build ${program}`);
    process.exit(1);
  }

  console.log();

  await createAccountsDir();

  // Write the account data for the program.
  const writeProgram = async () => {
    const data = Buffer.alloc(4 + 32);
    data.writeUint32LE(2, 0); // State: Program.
    data.set(program.exeAddress.toBytes(), 4); // Program address.

    const json = getAccountJson({
      pubkey: program.address,
      account: {
        data,
        owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
        executable: true,
      },
    });

    await fs.promises.writeFile(program.accountPath, json, "utf-8");
  };

  // Write the account data for the executable.
  const writeExe = async () => {
    const elf = await program.elf();

    const data = Buffer.alloc(4 + 8 + 1 + 32 + elf.length);
    data.writeUint32LE(3, 0); // State: Program data.
    data.writeBigUint64LE(0n, 4); // Slot.
    data.writeUint8(1, 4 + 8); // Option::Some for upgrade authority.
    data.set(wallet.publicKey.toBytes(), 4 + 8 + 1); // Upgrade authority address.
    data.set(elf, 4 + 8 + 1 + 32); // Raw program data.

    const json = getAccountJson({
      pubkey: program.exeAddress,
      account: {
        data,
        owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
        executable: false,
      },
    });

    await fs.promises.writeFile(program.exeAccountPath, json, "utf-8");
  };

  // Write the account data for the IDL.
  const writeIdl = async () => {
    const idl = await program.idl();

    const data = Buffer.alloc(8 + 32 + 4 + idl.length);
    data.set(IDL_ACCOUNT_DISCRIMINATOR, 0); // Discriminator.
    data.set(wallet.publicKey.toBytes(), 8); // Authority address.
    data.writeUint32LE(idl.length, 40); // Compressed IDL length.
    data.set(idl, 44); // Compressed IDL bytes.

    const json = getAccountJson({
      pubkey: program.idlAddress,
      account: {
        data,
        owner: program.address,
        executable: false,
      },
    });

    await fs.promises.writeFile(program.idlAccountPath, json, "utf-8");
  };

  await Promise.all([writeProgram(), writeExe(), writeIdl()]);
}

export const switchboard = (() => {
  const lib = "switchboard_v2";
  const address = SBV2_DEVNET_PID;

  return {
    lib,

    address,
    exeAddress: getExecutableAddress(address),
    idlAddress: getIdlAccountAddress(address),

    accountPath: path.join(ACCOUNTS_DIR, `${lib}.json`),
    exeAccountPath: path.join(ACCOUNTS_DIR, `${lib}-exe.json`),
    idlAccountPath: path.join(ACCOUNTS_DIR, `${lib}-idl.json`),
  } as const;
})();

/**
 * Fetch the Switchboard program from Devnet.
 */
export async function fetchSwitchboard(): Promise<void> {
  const connection = new Connection(clusterApiUrl("devnet"));

  let latest: number | undefined;

  // Get the latest transaction for the executable data.
  const [sigInfo] = await connection.getConfirmedSignaturesForAddress2(switchboard.exeAddress, {
    limit: 1,
  });

  if (sigInfo) {
    latest = sigInfo.blockTime ?? (await connection.getBlockTime(sigInfo.slot)) ?? undefined;
  }

  await createAccountsDir();

  const accounts = [
    [switchboard.address, switchboard.accountPath],
    [switchboard.exeAddress, switchboard.exeAccountPath],
    [switchboard.idlAddress, switchboard.idlAccountPath],
  ] as const;

  await Promise.all(
    accounts.map(async ([address, file]) => {
      let stat: fs.Stats | undefined;
      try {
        stat = await fs.promises.stat(file);
      } catch (err) {
        // Don't throw if the error is due to the file not existing.
        if (!isErrnoException(err) || err.code !== "ENOENT") {
          throw err;
        }
      }

      if (stat?.isFile() && (!latest || stat.mtimeMs / 1000 >= latest)) {
        // Up-to-date.
        return;
      }

      const account =
        (await connection.getAccountInfo(address)) ??
        __throw(new Error(`Failed to get account info for '${address}'`));

      const accountJson = getAccountJson({ pubkey: address, account });

      await fs.promises.writeFile(file, accountJson, "utf-8");
    }),
  );
}

////////////////////////////////////////////////////////////////////////////////

/**
 * Read a keypair from a JSON file.
 */
export function readKeypair(file: string): Keypair {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`error: could not read keypair file '${file}'`);
    process.exit(1);
  }

  if (
    !Array.isArray(data) ||
    data.length !== 64 ||
    !data.every((x) => typeof x === "number" && x >= 0 && x <= 255)
  ) {
    console.error(`error: invalid keypair file '${file}'`);
    process.exit(1);
  }

  const keypairBytes = new Uint8Array(64);
  keypairBytes.set(data);
  return Keypair.fromSecretKey(keypairBytes);
}

/**
 * Gets the minimum number of lamports to safely be rent exempt.
 */
export function minLamportsForRentExempt(size: number): number {
  return 2 * LAMPORTS_PER_BYTE_YEAR * (size + 128);
}

/**
 * Utility function to throw from an expression.
 */
export function __throw(error: Error): never {
  throw error;
}

const isErrnoException = (() => {
  const schema = new Map([
    ["code", new Set(["string", "undefined"])],
    ["errno", new Set(["number", "undefined"])],
    ["path", new Set(["string", "undefined"])],
    ["syscall", new Set(["string", "undefined"])],
  ]) as ReadonlyMap<string, ReadonlySet<string>>;

  return (err: unknown): err is NodeJS.ErrnoException => {
    if (!(err instanceof Error)) {
      return false;
    }

    for (const [prop, types] of schema.entries()) {
      if (!types.has(typeof (err as unknown as Record<PropertyKey, unknown>)[prop])) {
        return false;
      }
    }

    return true;
  };
})();
