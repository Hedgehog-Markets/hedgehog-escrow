import * as anchor from '@project-serum/anchor';
import type { Program } from '@project-serum/anchor';
import {
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
} from '@solana/web3.js';
import type { HhEscrow } from '../../target/types/hh_escrow';
import { intoU64BN } from '../u64';
import { createInitMintInstructions } from '../utils';
import type { InitializeMarketParams } from './utils';

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
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from('authority'), market.publicKey.toBuffer()],
    program.programId
  );
  const [yesTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('yes'), market.publicKey.toBuffer()],
    program.programId
  );
  const [noTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('no'), market.publicKey.toBuffer()],
    program.programId
  );

  beforeAll(async () => {
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
    expect.assertions(3);

    const user = Keypair.generate();
    const [userPosition] = PublicKey.findProgramAddressSync(
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

    expect(userPositionAccount.market).toEqualPubkey(market.publicKey);
    expect(userPositionAccount.yesAmount).toEqualBN(0);
    expect(userPositionAccount.noAmount).toEqualBN(0);
  });

  it('fails to initialize a user position if the seeds are incorrect', async () => {
    expect.assertions(1);

    const user = Keypair.generate();
    const [userPosition] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('user'),
        market.publicKey.toBuffer(),
        user.publicKey.toBuffer(),
      ],
      program.programId
    );

    await expect(
      program.methods
        .initializeUserPosition()
        .accounts({
          user: user.publicKey,
          payer: provider.wallet.publicKey,
          market: market.publicKey,
          userPosition,
        })
        .signers([user])
        .rpc()
    ).rejects.toThrow(SendTransactionError);
  });
});
