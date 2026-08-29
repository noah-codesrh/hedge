#!/usr/bin/env bash
# Prints live protocol state. Read-only; safe to run against mainnet at any time.
#
#   ./script/state.sh
#
# Reads ORACLE / VAULT / ENGINE / RPC from ../.env, so it follows whatever the
# last deploy wrote rather than hardcoding addresses that drift.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

c() { cast call "$1" "$2" ${3:-} --rpc-url "$RPC" | head -1 | awk '{print $1}'; }
usd() { python3 -c "print(f'\${int($1)/1e6:,.2f}')"; }
pct() { python3 -c "print(f'{int($1)/100:.2f}%')"; }

echo "vault  $VAULT"
echo "  total assets   $(usd "$(c "$VAULT" 'totalAssets()(uint256)')")"
echo "  senior         $(usd "$(c "$VAULT" 'seniorAssets()(uint256)')")"
echo "  junior         $(usd "$(c "$VAULT" 'juniorAssets()(uint256)')")"
echo "  locked         $(usd "$(c "$VAULT" 'lockedAssets()(uint256)')")"
echo "  free           $(usd "$(c "$VAULT" 'freeAssets()(uint256)')")"

echo "engine $ENGINE"
echo "  max leverage   $(python3 -c "print(f'{int($(c "$ENGINE" 'effectiveMaxLeverageBps()(uint256)'))/10000:.1f}x')")"
echo "  min margin     $(usd "$(c "$ENGINE" 'minMargin()(uint256)')")"
echo "  max margin     $(usd "$(c "$ENGINE" 'maxMargin()(uint256)')")"
echo "  opening paused $(c "$ENGINE" 'openingPaused()(bool)')"
echo "  borrow rate    $(c "$ENGINE" 'borrowRateBps()(uint256)') bp/hour"
echo "  open positions $(c "$ENGINE" 'openPositionCount()(uint256)')"

echo "oracle $ORACLE"
echo "  keeper reporter $(c "$ORACLE" 'isReporter(address)(bool)' "$KEEPER")"
echo "  guardian        $(c "$ENGINE" 'guardian()(address)')"

echo "markets"
(cd relayer && pnpm -s ids 2>/dev/null | grep '^0x') | while read -r ID SLUG _; do
  raw=$(cast call "$ENGINE" \
    'markets(bytes32)(bool,bool,uint128,uint128,uint128,uint128,uint128)' \
    "$ID" --rpc-url "$RPC" | grep -oE '^[0-9a-z]+')
  python3 - "$SLUG" $raw <<'PY'
import sys
slug, en, res, lo, hi, cap, *_ = sys.argv[1:]
band = f"{int(lo)/1e18:.2f}-{int(hi)/1e18:.2f}"
capn = "global only" if int(cap) == 0 else f"${int(cap)/1e6:,.0f}"
print(f"  {slug[:44]:<44} enabled={en:<5} resolved={res:<5} band={band} cap={capn}")
PY
done
