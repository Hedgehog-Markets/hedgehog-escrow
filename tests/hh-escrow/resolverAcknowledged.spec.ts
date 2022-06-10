import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import type { HhEscrow } from '../../target/types/hh_escrow';
import { intoU64BN } from '../u64';
import {
  createInitAccountInstructions,
  createInitMintInstructions,
} from '../utils';
import { ErrorCode, InitializeMarketParams } from './utils';

describe('hh-escrow deposit tests', () => {
  const YES_AMOUNT = 1_000_000;
  const NO_AMOUNT = 2_000_000;

  // Configure the client to use the local cluster.
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.HhEscrow as Program<HhEscrow>;

  // Parameters.
  const closeTs = BigInt(Date.now()) / 1000n + 3600n;
  const expiryTs = closeTs + 3600n;
  const resolver = Keypair.generate();
  const initializeMarketParams: InitializeMarketParams = {
    closeTs: intoU64BN(closeTs),
    expiryTs: intoU64BN(expiryTs),
    resolutionDelay: 3600,
    yesAmount: intoU64BN(YES_AMOUNT),
    noAmount: intoU64BN(NO_AMOUNT),
    resolver: resolver.publicKey,
    uri: '0'.repeat(256),
  };

  // Accounts.
  const mint = Keypair.generate();
  const market = Keypair.generate();
  const user = Keypair.generate();
  const userTokenAccount = Keypair.generate();
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
    const userTokenAccountIxs = await createInitAccountInstructions({
      account: userTokenAccount.publicKey,
      mint: mint.publicKey,
      user: user.publicKey,
      connection: provider.connection,
      payer: provider.wallet.publicKey,
    });

    await provider.send(
      new Transaction().add(...mintIxs, ...userTokenAccountIxs),
      [mint, userTokenAccount]
    );

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

  it('fails to acknowledge if the resolver does not sign', async () => {
    expect.assertions(1);

    await expect(
      program.methods
        .resolverAcknowledge()
        .accounts({
          market: market.publicKey,
          resolver: resolver.publicKey,
        })
        .rpc()
    ).rejects.toThrow();
  });

  it('fails to acknowledge if the incorrect resolver is provided', async () => {
    expect.assertions(1);
    const wrongResolver = Keypair.generate();

    await expect(
      program.methods
        .resolverAcknowledge()
        .accounts({
          market: market.publicKey,
          resolver: wrongResolver.publicKey,
        })
        .signers([wrongResolver])
        .rpc()
    ).rejects.toThrowAnchorError(ErrorCode.IncorrectResolver);
  });

  it('successfully acknowledges the market', async () => {
    expect.assertions(1);

    await program.methods
      .resolverAcknowledge()
      .accounts({
        market: market.publicKey,
        resolver: resolver.publicKey,
      })
      .signers([resolver])
      .rpc();

    const marketAccount = await program.account.market.fetch(market.publicKey);

    expect(marketAccount.acknowledged).toBe(true);
  });
});
