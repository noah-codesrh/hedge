# Hedge Leverage Engine

Synthetic micro-leverage on Polymarket binary outcomes, settled in USDG on
Robinhood Chain. Self-contained: nothing here is imported by the web app, and
the app's build does not compile or bundle any of it.

```
contracts/
  src/
    HedgeOracle.sol           relayed Polymarket YES prices
    HedgeVault.sol            dual-tranche USDG vault
    HedgeLeverageEngine.sol   open / close / liquidate
    interfaces/  lib/
  test/
    LeverageEngine.t.sol      26 tests
  script/
    Deploy.s.sol              deploys and wires the stack
    Configure.s.sol           registers the keeper, lists markets
    dryrun.sh                 full local end-to-end against anvil
  relayer/
    relayer.ts                price relay + liquidation keeper
    markets.json              the 3-10 whitelisted markets
```

## How it fits together

```
Trader ──► HedgeLeverageEngine ──► HedgeVault   (locks capital, takes fees, pays profit)
                    ▲
                    └─────────────  HedgeOracle  ◄── relayer.ts ◄── Polymarket CLOB
```

The engine escrows the trader's margin itself. The vault only ever holds LP
capital, fees and absorbed margin, so an engine bug cannot silently spend LP
funds outside the settlement paths.

## Running

```bash
forge build
forge test -vvv
```

Foundry only; there are no submodules and no third-party Solidity in the repo.
`test/Harness.sol` declares the handful of cheatcodes the tests use instead of
depending on forge-std.

The keeper has its own `package.json` and is not part of the app's workspace.
Node 22.18+ runs the TypeScript directly, so `tsx` is not needed:

```bash
cd relayer
cp .env.example .env      # fill in keys and addresses
pnpm install
pnpm ids                  # prints the bytes32 ids to list on-chain
pnpm start
```

## Dry run

Before touching a real chain, run the whole thing locally:

```bash
./script/dryrun.sh
```

It starts anvil on port 8547, deploys a mock 6-decimal USDG (`test/mocks/`, never
used anywhere but here and the unit tests), then deploys via the same
`Deploy.s.sol` and `Configure.s.sol` used in production, seeds both tranches,
opens a 2x long, and runs the real keeper, walking the price down until the
position liquidates. It
asserts the entry price, that liquidity is released, that the engine is drained,
and that vault TVL rises by exactly the trader's deposit. A break here is a break
in production.

Expected tail:

```
▸ Walking the price down to $0.25 — the oracle's 20% jump guard forces several steps
  [price] gap clamped, stepping to $0.4 toward $0.25
  [price] gap clamped, stepping to $0.32 toward $0.25
  [price] gap clamped, stepping to $0.256 toward $0.25
  [liquidate] position 1 · 0x2ad7ec…
  vault TVL $502.500000 — up by the trader's full $2.50 deposit
✓ dry run passed
```

The stepped prices are the oracle's jump guard working as intended: no single
update may move the price more than `maxDeviationBps`, so a gap is walked in
across several ticks instead of liquidating everyone at once on one bad print.

## Deploying

`$ADMIN` should be a multisig — it can change every risk parameter below. The
broadcasting key must be ADMIN, since `Deploy` also calls `setEngine`.

Collateral is The Global Dollar (USDG) at
`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`. That address is baked into
`Deploy.s.sol` as the default on chain 4663, so there is no `USDG` variable to
forget and setting it to anything else on Robinhood Chain reverts. On any other
chain — a local anvil, a testnet — it must be passed explicitly.

Two layers guard against binding the vault to the wrong token: that default, and
a constructor check that the collateral reports 6 decimals. Every cap in the
engine is a 6-decimal literal (`$5` is `5e6`), so an 18-decimal token would
inflate all of them by 1e12 rather than fail visibly.

Generate the admin account into Foundry's encrypted keystore rather than
handling the raw key. This prints the address and nothing else, so the key never
reaches a terminal, a dotfile or your shell history:

```bash
cast wallet new ~/.foundry/keystores hedge-admin
```

Then copy `.env.example` to `.env` — Foundry loads it automatically — and set
`ADMIN` to that address. Fund it with ETH for gas before broadcasting.

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $RPC --account hedge-admin --sender $ADMIN --broadcast
# prompts for the keystore password
# prints oracle / vault / engine addresses under "== Return =="

# ORACLE, ENGINE and KEEPER come from .env. Keep the grep: pnpm writes its own
# progress lines to stdout, and without it the first two ids are "Already" and
# "Done", which envBytes32 will not parse.
MARKET_IDS=$(cd relayer && pnpm -s ids | grep '^0x' | awk '{print $1}' | paste -sd, -) \
forge script script/Configure.s.sol:Configure \
  --rpc-url $RPC --account hedge-admin --sender $ADMIN --broadcast
```

`--private-key` works too, but it leaves the most dangerous key in the
environment for the whole session and in history afterwards.

`Deploy` wires `vault.setEngine` in the same run, because that call is one-time
and irreversible — doing it immediately removes the window where a deployed
vault sits unclaimed. `Configure` skips markets that are already listed, so it
is safe to re-run as you add more.

Finally, seed the first-loss buffer: `vault.depositJunior(100e6)`.

## Keys

Three separate roles. Do not collapse them into one key.

| Role | Holds | Can do |
|---|---|---|
| **Admin** | deployer key, ideally a multisig | everything: `adminSetPrice` past the jump guard, `withdrawJunior`, rewrite every rule, `transferAdmin` |
| **Keeper** | throwaway hot key on the server | push prices, call `liquidatePosition`, and — as guardian — halt new positions |
| **Trader** | end users | open and close their own positions |

The guardian role is deliberately one-way: it can stop opening and it can lift
a pause it set itself, but it cannot clear a pause the admin put in place, and
it touches nothing else. The worst a compromised keeper can do with it is deny
service, which is recoverable; the alternative is nobody being able to react for
minutes while the vault bleeds.

The keeper key signs every few seconds from an always-on box, so treat it as
already compromised and give it nothing else. Generate a fresh one with
`cast wallet new`, fund it with ETH for gas, and register it with
`setReporter`.

Reusing the admin key as the keeper removes the only recovery path you have. A
leaked keeper key is revoked with one `setReporter(key, false)`; a leaked admin
key can drain the junior tranche, liquidate every open position by setting an
arbitrary price, and transfer the admin role away from you. The keeper is also a
frequent sender, so sharing the account guarantees nonce collisions with admin
transactions.

A leaked keeper key is not harmless on its own — it can still walk prices
`maxDeviationBps` at a time and force liquidations over several ticks. Watch for
prices that move against the CLOB, and revoke on suspicion.

## Keeping the keeper alive

If the keeper stops, prices freeze, liquidations stop and underwater positions
sit there costing the vault money until someone notices. `emergencyClose` stops
trader funds being trapped after 24 hours, but it does nothing about the losses
in between. So the keeper is built to be noisy about its own health.

**Hosting.** `docker compose up -d --build` from `relayer/`. `restart:
unless-stopped` covers crashes and host reboots; the container healthcheck
covers the worse case where the process is alive but has stopped ticking.

**Health endpoint.** `GET :8080/health` returns 200 while ticks are landing and
503 once the last clean tick is older than `HEALTH_STALE_AFTER_MS` (default 4
minutes, deliberately under the oracle's 5-minute staleness window so you hear
about it before trading halts itself). `GET :8080/metrics` is the same numbers
in Prometheus format.

Point an external uptime monitor at `/health` — Better Stack, UptimeRobot,
Healthchecks.io, anything. This is the piece that catches a silent death: if the
container is gone the endpoint stops answering, if the container is stuck the
endpoint answers 503, and either way the monitor pages you. Self-reporting alone
cannot catch a process that is no longer running.

**Alerts.** Set `ALERT_WEBHOOK_URL` (Slack or Discord) and/or a Telegram bot
token. The keeper alerts on failing ticks, markets it could not price, gas below
`MIN_BALANCE_ETH`, an oracle stuck converging, and its own crash on the way out.
Repeats are suppressed for `ALERT_COOLDOWN_MS` and recoveries are announced, so
the channel stays worth reading.

**The brake.** After `FAILURES_BEFORE_PAUSE` consecutive failed ticks, and on
SIGTERM, the keeper calls `guardianSetPaused(true)` and halts new positions
itself. Prices going stale would eventually do the same thing, but this shuts
the door in seconds rather than minutes. It resumes automatically once it is
healthy again. This needs `setGuardian(keeper)`, which `Configure.s.sol` does
for you; without it the keeper logs a warning at startup and runs without a
brake.

**Two keepers is better than one.** Both jobs are idempotent — liquidation is
permissionless and re-verified on-chain, so a duplicate call reverts rather than
doing damage. Run a second instance in another region and the only cost is a
little wasted gas on races.

Gas is the failure mode that looks exactly like a crash while the logs stay
calm, so keep the keeper funded and treat the `low-gas` alert as urgent.

## The rules, and how to change them

Every threshold is admin-settable, so the risk envelope widens as the vault
grows without redeploying anything.

| Parameter | Default | Setter |
|---|---|---|
| Min margin per position | $1.00 | `setMinMargin` |
| Max margin per position | $5.00 | `setRiskParams` |
| Max position size | $25.00 | `setRiskParams` |
| Leverage schedule | 2x → 5x by TVL | `setLeverageTiers` |
| Leverage ceiling | 5.00x | `setRiskParams` |
| Max pool exposure | 30% of TVL | `setRiskParams` |
| Entry / exit fee | 1.5% of size | `setFeeParams` |
| Entry spread | 1.0% | `setFeeParams` |
| Borrow carry | 1 bp/hour on borrowed | `setBorrowRateBps` |
| Liquidation threshold | 90% of net margin | `setLiquidationThresholdBps` |
| Tradeable price band | $0.35 – $0.65 | `setDefaultBand`, `updateMarket` |
| Fee split | 70% senior / 30% junior | `vault.setFeeSeniorBps` |
| Oracle staleness | 5 minutes | `oracle.setMaxPriceAge` |
| Oracle jump guard | 20% per update | `oracle.setMaxDeviationBps` |
| Emergency exit delay | 24 hours | `setStaleCloseDelay` |

### Leverage scales with liquidity, on its own

`maxLeverageBps` is a ceiling, not the number traders get. What they get comes
from a tier schedule read against live vault TVL on every open:

| Vault TVL | Max leverage |
|---|---|
| under $1,000 | 2.0x |
| $1,000+ | 3.0x |
| $5,000+ | 4.0x |
| $20,000+ | 5.0x |

Nobody calls anything to move between rows. An LP deposit that crosses $1,000
raises the cap on the very next transaction, and a withdrawal that drops back
below lowers it again, so the pool can never end up levered beyond what it can
absorb. `nextLeverageTier()` returns the TVL of the next step and the leverage
it unlocks, which is what the EARN page should show LPs.

One trap to know about, because it is silent: `maxPositionSize` bounds the whole
position, so it caps leverage too. At $10 with a $5 max margin, nobody posting
the full deposit can exceed 2x, and the upper tiers stay advertised while every
attempt to use them reverts with `PositionTooLarge`. Keep it at or above
`maxMargin × maxLeverageBps`, which is the $25 default.

`setLeverageTiers` replaces the schedule; it rejects an empty list, requires the
first row to start at zero TVL, requires ascending thresholds and refuses any
row above `maxLeverageBps`. Lowering the ceiling with `setRiskParams` is the
emergency brake — it caps the result immediately whatever the schedule says.

### Carry, and closing part of a position

Leverage borrows vault capital, so it costs something to hold. The engine
charges `borrowRateBps` per hour on the borrowed slice — `size - margin`, which
means a 1x position pays nothing at all. It accrues by the second and is
settled out of the trader's margin on exit, where it splits 70/30 like every
other fee.

At the 1 bp/hour default a $5 position with $2.50 borrowed costs $0.006 a day.
That is deliberately small next to the 3% round trip: the point is to stop a
winning position parking vault liquidity indefinitely for free, not to earn
from it. `MAX_BORROW_RATE_BPS` caps what any admin call can set, and a position
keeps the rate it opened at, so nobody's carry can be raised underneath them.

Carry eats margin, so it also pulls the liquidation price in. The stored
`liquidationPrice` is the open-time figure and never moves;
`liquidationPriceNow(id)` is the live one and is what a trader should be shown.
`fundingOwed(id)` returns the accrued amount.

`reducePosition(id, fractionBps)` closes part of a position and leaves the rest
running. Everything scales together — size, shares, margin, reservation, and
the carry owed — so the remainder is the same trade in miniature at the same
entry and the same liquidation price, and the freed reservation is available to
the next trader immediately. The leftover must still clear `minMargin`; pass
`10_000` to close the lot.

### Three safeguards worth understanding

**The oracle admits when it is behind.** A binary market can gap 40 cents on a
headline. The oracle only lets the settlement price move `maxDeviationBps` per
update, which is what stops one bad print from liquidating everybody — but it
means that during a real gap the on-chain price is knowingly wrong, and anyone
watching Polymarket can open into the lag for free money out of the vault.

The clamp therefore lives on-chain, not in the keeper. Reporters push the *true*
midpoint; the oracle stores the clamped value as the settlement price and the
unclamped one as `target`, and `isConverging` is true while they differ.
`openPosition` reverts with `PriceConverging` while that holds, so the arbitrage
window closes automatically the instant a gap appears and reopens once the price
has caught up. No human, and no keeper, has to be awake for it.

Closing and liquidation stay available while converging. Those positions already
carry real exposure and freezing their exits would be worse than settling a few
ticks behind. Keeping the clamp on-chain also means a compromised reporter
cannot hide a gap by pre-clamping it off-chain — the contract computes the
distance itself. `adminSetPrice` skips the walk for a gap the admin has
independently confirmed.

**A margin floor, not a UX choice.** Below roughly $0.67 the 1.5% fee rounds to
zero under integer division, so a 1-unit margin would open a real position for
the price of gas. The keeper scans every open position on every tick, so cheap
dust is a way to stall liquidations for the whole protocol. `minMargin` is the
fix, and `setMinMargin` cannot be set to zero.

**`emergencyClose` exists because closing needs a fresh price.** A dead keeper
freezes prices, and `closePosition` reverts on a stale one — so without an
escape hatch an outage would trap every trader's margin indefinitely. After
`staleCloseDelay` a trader can unwind at **zero PnL**: net margin back, no
payout computed against a frozen price. Settling at the last known price instead
would hand the vault's money to whoever the outage happened to favour and let
losing positions cash out above their true value. The vault keeps fees it
already earned, and no exit fee is charged on a path that only opens because the
protocol stopped working.

Admin transfer is two-step (`transferAdmin` then `acceptAdmin`), so a typo
cannot strand the role.

Markets are opt-in one at a time via `listMarketWithDefaults`. `setMarketEnabled`
stops new positions while still letting open ones close or liquidate. Follow the
blacklist in the brief when choosing them — avoid high-odds markets (no
liquidation risk, capital just sits), long-horizon markets (capital locked for
years) and thin niche markets (unreliable oracle updates). The $0.35–$0.65 band
enforces the first of those automatically.

## Worked example

2x long on a $0.50 outcome with a $2.50 deposit:

| | |
|---|---|
| Position size | $5.00 |
| Entry price (1% spread) | $0.505 |
| Entry fee (1.5% of size) | $0.075 |
| Net margin | $2.425 |
| Shares | 9.900990 |
| Liquidation price | **$0.284568** |
| Vault reserve | $4.900990 |

## Three places this departs from the brief

**1. The vault reserves the worst-case payout, not the "borrowed" $2.50.**

The brief describes the vault lending $2.50 to build a $5.00 position. That
under-reserves. A binary outcome can run to $1.00, at which point this position
is worth 9.900990 shares = $9.90, and the vault owes $4.90 of profit — nearly
twice what it set aside. A short is worse: its maximum payout is the entire
position size. Reserving only the borrowed slice would let a few winners leave
the vault unable to pay, so `_maxPayout` reserves the full potential profit.

The practical cost is capacity: a $100 vault at the 30% cap backs about six
concurrent $5 positions rather than twelve. Raising `maxPoolExposureBps` trades
that back for risk. Everything else in the brief — instant fee capture, liquidity
released the moment a position closes, short trades being good for the protocol —
is unaffected.

**2. The liquidation price is $0.2846, not $0.270.**

The brief gives three figures that cannot all hold at once: a 90% margin
threshold, a ~$0.270 liquidation price, and a "25–30% price drop" trigger. At 2x
with a 90% threshold the answer is fixed:

```
max loss  = $2.425 x 0.90        = $2.1825
liq price = $0.505 x (5 - 2.1825)/5 = $0.284568   (a 43% fall from $0.50)
```

The 90% rule is implemented as written, since that is the stated rule.
`test_ThresholdIsTunable` shows that dropping `liquidationThresholdBps` to 6000
moves the trigger into the 25–30% band if that was the real intent — one admin
call, no redeploy.

**3. Liquidated margin splits 70/30 like fees.**

The brief says absorbed margin goes "100% into the Vault" but not how the two
tranches share it. It follows the fee split by default, adjustable via
`vault.setLiquidationSeniorBps`. Setting it to 0 would send all liquidation
proceeds to the junior tranche to rebuild the first-loss buffer faster.

## APR / APY

Not yet surfaced anywhere — the inputs exist on-chain but the EARN page is still
to build. Senior fee income over a window comes from `FeeCollected(amount,
toSenior, toJunior)` and `MarginAbsorbed(...)` on the vault; the denominator is
`vault.seniorAssets()`.

```
APR = (senior fees over 30d x 12) / total senior USDG x 100
APY = (1 + APR/52)^52 - 1
```

## The frontend side

Built and wired, but inert until the addresses exist. Set
`VITE_HEDGE_ENGINE_ADDRESS`, `VITE_HEDGE_VAULT_ADDRESS`, and
`VITE_HEDGE_STOCK_COLLATERAL` in the app's `.env`
after deploying and the leverage selector starts submitting and the Earn page
comes alive. Until then the panel shows sizing and refuses to submit, and Earn
says the vault is not live — both deliberate, so a levered ticket can never
fall through to an unlevered Polymarket fill.

The app talks to these contracts through a hand-written ABI in
`app/lib/leverage-abi.ts`, encodes its own calldata, and reaches the chain via
the sponsored-send endpoint so traders never need ETH here. None of that is
covered by `forge test`, so `script/frontend-abi-check.ts` drives every call
the UI makes against a real deployment; `dryrun.sh` runs it. If you rename a
function or change the `Position` struct, that check is what tells you.

One thing worth knowing before adding reads: Robinhood Chain has no Multicall3,
and viem throws rather than falling back, so batched reads have to be plain
parallel `eth_call`s.

## Not built yet

- The external uptime monitor. Everything on the keeper's side is built —
  `/health`, `/metrics`, webhook alerts — but something still has to watch the
  endpoint from outside the box. Ten minutes of setup, and it is the only thing
  that catches the container disappearing entirely.
- `MOCK_PRICES` is a dry-run-only escape hatch. Make sure it is unset in
  production, or the keeper will relay invented prices.
- Token tax injection is a plain `depositJunior` call from whatever collects it;
  no dedicated hook.
- No audit. This holds real funds — get it reviewed before mainnet.
