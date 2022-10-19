import { NATIVE_MINT } from "@solana/spl-token";
import { OracleJob } from "@switchboard-xyz/common";
import {
  AggregatorAccount,
  CrankAccount,
  JobAccount,
  LeaseAccount,
  OracleAccount,
  OracleQueueAccount,
  PermissionAccount,
  ProgramStateAccount,
  SwitchboardPermission,
  programWallet,
} from "@switchboard-xyz/switchboard-v2";
import BN from "bn.js";

import { loadSwitchboardProgram } from "@/switchboard";
import { program } from "@/switchboard-resolver";
import { toBuffer } from "@/utils";

import type { SwitchboardProgram } from "@/switchboard";
import type { IOracleJob } from "@switchboard-xyz/common";

describe("initialize switchboard resolver", () => {
  let switchboard: SwitchboardProgram,
    queue: OracleQueueAccount,
    crank: CrankAccount,
    oracle: OracleAccount,
    aggreggator: AggregatorAccount,
    lease: LeaseAccount,
    job: JobAccount;

  beforeAll(async () => {
    switchboard = await loadSwitchboardProgram;

    const [stateAccount] = ProgramStateAccount.fromSeed(switchboard);
    const { tokenVault } = await switchboard.account.sbState.fetch(stateAccount.publicKey);

    const authority = programWallet(switchboard);

    queue = await OracleQueueAccount.create(switchboard, {
      authority: authority.publicKey,
      reward: new BN(0),
      minStake: new BN(0),
      mint: NATIVE_MINT,
    });

    crank = await CrankAccount.create(switchboard, {
      queueAccount: queue,
    });

    oracle = await OracleAccount.create(switchboard, {
      queueAccount: queue,
    });

    {
      const oraclePermission = await PermissionAccount.create(switchboard, {
        authority: authority.publicKey,
        granter: queue.publicKey,
        grantee: oracle.publicKey,
      });
      await oraclePermission.set({
        authority,
        permission: SwitchboardPermission.PERMIT_ORACLE_HEARTBEAT,
        enable: true,
      });
      await oracle.heartbeat(authority);
    }

    aggreggator = await AggregatorAccount.create(switchboard, {
      authority: authority.publicKey,
      batchSize: 1,
      minRequiredJobResults: 1,
      minRequiredOracleResults: 1,
      minUpdateDelaySeconds: 10,
      queueAccount: queue,
    });

    {
      const aggreggatorPermission = await PermissionAccount.create(switchboard, {
        authority: authority.publicKey,
        granter: queue.publicKey,
        grantee: aggreggator.publicKey,
      });
      await aggreggatorPermission.set({
        authority,
        permission: SwitchboardPermission.PERMIT_ORACLE_QUEUE_USAGE,
        enable: true,
      });
    }

    lease = await LeaseAccount.create(switchboard, {
      loadAmount: new BN(0),
      funder: tokenVault,
      funderAuthority: authority,
      oracleQueueAccount: queue,
      aggregatorAccount: aggreggator,
    });

    {
      const jobDefinition: IOracleJob = {
        tasks: [
          {
            valueTask: { big: "1" },
          },
        ],
      };
      const jobData = OracleJob.encodeDelimited(jobDefinition).finish();

      job = await JobAccount.create(switchboard, {
        authority: authority.publicKey,
        data: toBuffer(jobData),
      });
    }

    await aggreggator.addJob(job, authority);
    await crank.push({ aggregatorAccount: aggreggator });
  });

  it("successfully inititializes resolver", async () => {
    program.methods.initialize().accounts({});
  });
});
