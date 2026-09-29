import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
  type Chain,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { ServerConfig } from './config.js';

// xBZZ is 16 decimals, not the usual 18. Getting this wrong under- or over-funds by 100x.
export const BZZ_DECIMALS = 16;

// Kept out of the per-wallet amounts: the funder must retain enough native balance to pay
// for the two transfers' gas, or the second transfer of a batch strands the first.
const GAS_RESERVE_XDAI = '0.005';

// A voucher wallet as it exists in this process's memory and NOWHERE else. The private key
// is generated here, returned to the payer in the purchase response, and never persisted —
// not in sqlite, not in a file, not in a log line. A crash between funding and response
// therefore strands that wallet's funds forever; that is the accepted trade for a server
// that cannot leak what it never stored.
export interface VoucherWallet {
  address: `0x${string}`;
  privateKey: `0x${string}`;
}

export interface FundResult {
  xdaiTx: string;
  xbzzTx: string;
}

export class VoucherError extends Error {}

export function createVoucherWallet(): VoucherWallet {
  const privateKey = generatePrivateKey();
  return { address: privateKeyToAccount(privateKey).address, privateKey };
}

export class VoucherFunder {
  private readonly chain: Chain;
  private readonly account: PrivateKeyAccount;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly xdaiWei: bigint;
  private readonly bzzUnits: bigint;
  private readonly token: `0x${string}`;
  // Funding runs strictly one wallet at a time: concurrent settlements share this single
  // funder account, and two in-flight transactions from one EOA collide on nonces. Node is
  // single-process, so a promise chain is a sufficient mutex.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: ServerConfig) {
    this.chain = defineChain({
      id: config.giftChainId,
      name: 'Gnosis',
      nativeCurrency: { name: 'xDAI', symbol: 'xDAI', decimals: 18 },
      rpcUrls: { default: { http: [config.giftRpcUrl] } },
    });
    this.account = privateKeyToAccount(normalizePk(config.giftFunderPk));
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.giftRpcUrl),
      // viem defaults to 4s when the chain carries no blockTime, which showed up as ~2.5s of
      // dead time between a funding transfer landing and this server noticing. Gnosis blocks
      // are ~5s, so polling every second costs a few extra RPC calls per sale and nothing else.
      pollingInterval: 1_000,
    });
    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(config.giftRpcUrl),
    });
    // Decimal strings straight from the env — never float math. parseUnits rejects values
    // with more fractional digits than the asset carries rather than truncating.
    this.xdaiWei = parseEther(config.giftXdaiAmount);
    this.bzzUnits = parseUnits(config.giftXbzzAmount, BZZ_DECIMALS);
    this.token = config.giftXbzzAddress as `0x${string}`;
  }

  get funderAddress(): string {
    return this.account.address;
  }

  // Serialized entry point: resolves to the two transfer hashes, throws VoucherError when the
  // transfer could not be completed. The caller decides what a failure means for the response.
  fund(recipient: `0x${string}`): Promise<FundResult> {
    const run = this.queue.then(() => this.fundOne(recipient));
    // The queue must survive a rejection or every later purchase inherits the failure.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async fundOne(recipient: `0x${string}`): Promise<FundResult> {
    // Refuse before spending gas on a transfer that cannot complete.
    const [nativeBalance, bzzBalance] = await Promise.all([
      this.publicClient.getBalance({ address: this.account.address }),
      this.publicClient.readContract({
        address: this.token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [this.account.address],
      }),
    ]);
    const gasReserve = parseEther(GAS_RESERVE_XDAI);
    if (nativeBalance < this.xdaiWei + gasReserve) {
      throw new VoucherError(
        `funder holds ${formatEther(nativeBalance)} xDAI, needs ` +
          `${formatEther(this.xdaiWei + gasReserve)} including the gas reserve`,
      );
    }
    if (bzzBalance < this.bzzUnits) {
      throw new VoucherError(
        `funder holds ${formatUnits(bzzBalance, BZZ_DECIMALS)} xBZZ, needs ` +
          `${this.config.giftXbzzAmount}`,
      );
    }

    // Two plain transfers from one EOA. They used to be fully sequential — each awaited to its
    // receipt before the next was even broadcast — which meant the second could never share a
    // block with the first: measured 5s apart, in consecutive Gnosis blocks, for no reason
    // beyond viem picking the nonce implicitly and two concurrent sends therefore colliding on
    // it. Naming the nonces removes that constraint.
    //
    // One read, not a counter: `queue` guarantees no other funding is in flight and fundOne
    // awaits both receipts before releasing it, so the pending count is accurate here — and
    // unlike an in-process counter it re-syncs by itself after a dropped transaction.
    const nonce = await this.publicClient.getTransactionCount({
      address: this.account.address,
      blockTag: 'pending',
    });

    // Broadcast stays ordered even though confirmation does not. A send is ~200ms, so
    // serialising the two costs nothing measurable, and it rules out the one real hazard of
    // firing them together: a node that sees nonce+1 first can reject it outright rather than
    // holding it as a future nonce.
    const xdaiTx = await this.walletClient.sendTransaction({
      account: this.account,
      chain: this.chain,
      to: recipient,
      value: this.xdaiWei,
      nonce,
    });

    const xbzzTx = await this.walletClient.writeContract({
      account: this.account,
      chain: this.chain,
      address: this.token,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [recipient, this.bzzUnits],
      nonce: nonce + 1,
    });

    // Consecutive nonces, so the protocol orders them and a validator building the next block
    // takes both. Waiting on them together is what lets that happen.
    //
    // The trade: both are already broadcast, so a reverted xDAI transfer no longer cancels the
    // xBZZ one, and the recipient could end up holding tokens with no gas to move them. A
    // native transfer to a fresh EOA does not revert in practice and the balance precheck above
    // covers the insufficient-funds case, so the reachable failure is a *stuck* first
    // transaction — and there the nonce gap stalls the second anyway, surfacing as the same
    // timeout it would have before.
    await Promise.all([this.waitOk(xdaiTx, 'xDAI transfer'), this.waitOk(xbzzTx, 'xBZZ transfer')]);

    return { xdaiTx, xbzzTx };
  }

  private async waitOk(hash: `0x${string}`, what: string): Promise<void> {
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 120_000,
    });
    if (receipt.status !== 'success') {
      throw new VoucherError(`${what} reverted: ${hash}`);
    }
  }
}

function normalizePk(pk: string): `0x${string}` {
  return (pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`;
}
