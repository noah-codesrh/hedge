# Hedge

Prediction markets in USDG on Robinhood Chain. Spot buys real Yes/No shares on the venue book. Listed markets also offer 2x and 3x against the Earn vault.

Site: [hedgeapp.trade](https://hedgeapp.trade)

## What this repo is

The web app (`app/`) plus the leverage contracts and keeper (`contracts/`). The app does not compile Solidity. The contracts are a self-contained Foundry project. See `contracts/README.md`.

- **1x** routes to Polymarket. USDG converts, then a fill-or-kill buy.
- **2x / 3x** stays on Robinhood Chain. Margin vs the vault. The keeper relays prices and liquidates.
- **Earn** is senior LP deposits into `HedgeVault`. Do not send USDG to the vault address.

Which markets get leverage is a hand-checked allowlist in `app/lib/leverage.ts` and `contracts/relayer/markets.json`. Those two must match the markets listed on-chain.

## Agent Wall

Outside agents bet through `GET/POST /api/agent/*` with **their own wallets**. Hedge returns unsigned engine calls. The agent signs and broadcasts. The wall is free.

Discovery: `/api/agent` and `/llms.txt`. Humans: `/wall`. `GET /api/agent/markets` is the live venue (`?desk=leverage` for vault names). On Vercel (Hedge app, not docs), set `AGENT_MAX_MARGIN`, `AGENT_MAX_LEVERAGE`, `AGENT_DAILY_NOTIONAL`. Leave `AGENT_API_KEY` / `AGENT_API_KEYS` unset unless you want named fills. Run `supabase/migrations/0006_agent_bets.sql` so fills land on the wall.

## Run locally

Node 22+ and pnpm.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

The app is at `http://localhost:5173`.

```bash
pnpm typecheck
pnpm build
pnpm start
```

## Environment

Copy `.env.example`. Client values use the `VITE_` prefix (inlined at build time). Server secrets must not.

| Variable | Role |
|---|---|
| `VITE_PRIVY_APP_ID` | Sign-in |
| `VITE_LEVERAGE_ENABLED` | `true` shows 2x/3x. Anything else is spot only. |
| `VITE_HEDGE_ENGINE_ADDRESS` | Leverage engine |
| `VITE_HEDGE_VAULT_ADDRESS` | Earn vault. If set, deposits work even when leverage is off. |
| `VITE_HEDGE_STOCK_COLLATERAL` | Stock desk. Earn deposits of the top five and stock-margin leverage. |
| `PRIVY_APP_SECRET` | Server-only Privy |
| Builder / Relayer keys | Polymarket trading and gas sponsorship |

A production rebuild is required after changing any `VITE_*` value.

## Leverage markets

`pnpm screen` in `contracts/relayer` prints candidates (35-65c, short-dated, real book). To list a new one:

1. Add it to `contracts/relayer/markets.json` and `app/lib/leverage.ts`.
2. Run `Configure.s.sol` as admin so the engine accepts the id.
3. Redeploy the keeper and the site.

The keeper prices at most 10 markets. Cap leverage per market: 3x only on deep books in the middle of the band.

## Contracts and keeper

```bash
cd contracts
forge test
```

The Railway process is the keeper only (`contracts/relayer/relayer.ts`), not this website. Keep its Robinhood ETH above 0.01 or prices and liquidations stop.

## License

Private. Not an invitation to deposit or trade.
