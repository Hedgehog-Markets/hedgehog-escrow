import * as anchor from '@project-serum/anchor';
import * as assert from 'assert';
import type { Program } from '@project-serum/anchor';
import { Keypair, Transaction } from '@solana/web3.js';
import type { HhEscrow } from '../../target/types/hh_escrow';
import { intoU64, intoU64BN } from '../u64';
import { createInitMintInstructions } from '../utils';
import type { InitializeMarketParams } from './utils';
import { findProgramAddressSync } from '@project-serum/anchor/dist/cjs/utils/pubkey';

describe('initialize user position', () => {
  // Configure the client to use the local cluster.
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.HhEscrow as Program<HhEscrow>;
  const closeTs = BigInt(Date.now()) / 1000n + 3600n;
  const expiryTs = closeTs + 3600n;
  const resolver = Keypair.generate();
  const initializeMarketParams: InitializeMarketParams = {
    closeTs: intoU64BN(closeTs),
    expiryTs: intoU64BN(expiryTs),
    resolutionDelay: 3600,
    yesAmount: intoU64BN(1_000_000),
    noAmount: intoU64BN(2_000_000),
    resolver: resolver.publicKey,
    uri: '0'.repeat(256),
  };
  const mint = Keypair.generate();
  const market = Keypair.generate();
  const [authority] = findProgramAddressSync(
    [Buffer.from('authority'), market.publicKey.toBuffer()],
    program.programId
  );
  const [yesTokenAccount, yesNonce] = findProgramAddressSync(
    [Buffer.from('yes'), market.publicKey.toBuffer()],
    program.programId
  );
  const [noTokenAccount, noNonce] = findProgramAddressSync(
    [Buffer.from('no'), market.publicKey.toBuffer()],
    program.programId
  );

  before(async () => {
    const mintIxs = await createInitMintInstructions({
      mint: mint.publicKey,
      mintAuthority: provider.wallet.publicKey,
      connection: provider.connection,
      payer: provider.wallet.publicKey,
    });

    await provider.send(new Transaction().add(...mintIxs), [mint]);

    await program.methods
      .initializeMarket(initializeMarketParams)
      .accounts({
        market: market.publicKey,
        tokenMint: mint.publicKey,
        authority,
        yesTokenAccount,
        noTokenAccount,
      })
      .signers([market])
      .rpc();
  });

  it('initializes a user position correctly', async () => {
    const user = Keypair.generate();
    const [userPosition] = findProgramAddressSync(
      [
        Buffer.from('user'),
        user.publicKey.toBuffer(),
        market.publicKey.toBuffer(),
      ],
      program.programId
    );
    await program.methods
      .initializeUserPosition()
      .accounts({
        user: user.publicKey,
        payer: provider.wallet.publicKey,
        market: market.publicKey,
        userPosition,
      })
      .signers([user])
      .rpc();

    const userPositionAccount = await program.account.userPosition.fetch(
      userPosition
    );

    assert.ok(userPositionAccount.market.equals(market.publicKey));
    assert.strictEqual(intoU64(userPositionAccount.yesAmount), 0n);
    assert.strictEqual(intoU64(userPositionAccount.noAmount), 0n);
  });

  it('fails to initialize a user position if the seeds are incorrect', async () => {
    const user = Keypair.generate();
    const [userPosition] = findProgramAddressSync(
      [
        Buffer.from('user'),
        market.publicKey.toBuffer(),
        user.publicKey.toBuffer(),
      ],
      program.programId
    );

    await assert.rejects(async () => {
      await program.methods
        .initializeUserPosition()
        .accounts({
          user: user.publicKey,
          payer: provider.wallet.publicKey,
          market: market.publicKey,
          userPosition,
        })
        .signers([user])
        .rpc();
    });
  });
});
