#!/usr/bin/env bash
#
# End-to-end dry run against a local anvil node.
#
# Deploys the whole stack, seeds both tranches, opens a leveraged position, then
# runs the real keeper with mocked prices and walks the price down until the
# position liquidates on-chain. Exercises the same Deploy/Configure scripts used
# for a real deployment, so a break here is a break in production too.
#
#   ./script/dryrun.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

# Non-default port so this never collides with an anvil you already have running.
PORT=${DRYRUN_PORT:-8547}
RPC=http://127.0.0.1:$PORT
# anvil's first default account.
PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ADMIN=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
# Second account, acting as both trader and keeper.
TRADER_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
TRADER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8

SLUG="dryrun-market"
MARKET_ID=$(cast keccak "$SLUG")

log() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1"; exit 1; }

cleanup() { [[ -n "${ANVIL_PID:-}" ]] && kill "$ANVIL_PID" 2>/dev/null || true; }
trap cleanup EXIT

log "Starting anvil on port $PORT"
anvil --silent --port "$PORT" >/tmp/hedge-anvil.log 2>&1 &
ANVIL_PID=$!
for _ in {1..30}; do
  cast block-number --rpc-url $RPC >/dev/null 2>&1 && break
  sleep 0.3
done
cast block-number --rpc-url $RPC >/dev/null 2>&1 || fail "anvil did not start"

log "Deploying mock USDG"
USDG=$(forge create test/mocks/MockUSDG.sol:MockUSDG \
  --rpc-url $RPC --private-key $PK --broadcast --json | jq -r .deployedTo)
echo "  USDG    $USDG"

log "Deploying the stack (script/Deploy.s.sol)"
# forge emits one JSON object per line; the first carries the named returns.
ADMIN=$ADMIN USDG=$USDG forge script script/Deploy.s.sol:Deploy \
  --rpc-url $RPC --private-key $PK --broadcast --json >/tmp/hedge-deploy.json 2>/dev/null
returned() {
  jq -s -r "map(select(type==\"object\" and has(\"returns\"))) | .[0].returns.$1.value" \
    /tmp/hedge-deploy.json
}
ORACLE=$(returned oracle)
VAULT=$(returned vault)
ENGINE=$(returned engine)
[[ "$ORACLE" == 0x* && "$VAULT" == 0x* && "$ENGINE" == 0x* ]] || fail "deploy did not return addresses"
echo "  oracle  $ORACLE"
echo "  vault   $VAULT"
echo "  engine  $ENGINE"

log "Configuring (script/Configure.s.sol)"
ORACLE=$ORACLE ENGINE=$ENGINE KEEPER=$TRADER MARKET_IDS=$MARKET_ID \
  forge script script/Configure.s.sol:Configure \
  --rpc-url $RPC --private-key $PK --broadcast >/dev/null 2>&1
[[ $(cast call "$ORACLE" "isReporter(address)(bool)" "$TRADER" --rpc-url $RPC) == "true" ]] \
  || fail "keeper was not registered as a reporter"
echo "  market  $MARKET_ID listed, keeper registered"

log "Seeding the vault: \$100 junior, \$400 senior"
cast send "$USDG" "mint(address,uint256)" "$ADMIN" 500000000 \
  --rpc-url $RPC --private-key $PK >/dev/null
cast send "$USDG" "approve(address,uint256)" "$VAULT" \
  115792089237316195423570985008687907853269984665640564039457584007913129639935 \
  --rpc-url $RPC --private-key $PK >/dev/null
cast send "$VAULT" "depositJunior(uint256)" 100000000 --rpc-url $RPC --private-key $PK >/dev/null
cast send "$VAULT" "depositSenior(uint256)" 400000000 --rpc-url $RPC --private-key $PK >/dev/null
echo "  TVL     \$$(echo "scale=2; $(cast call "$VAULT" "totalAssets()(uint256)" --rpc-url $RPC | awk '{print $1}') / 1000000" | bc)"

log "Keeper tick 1: relaying \$0.50 onto the oracle"
# Point the keeper at a throwaway config rather than editing the tracked one.
MARKETS_FILE=/tmp/hedge-dryrun-markets.json
cat > "$MARKETS_FILE" <<EOF
[{"label":"Dry run","slug":"$SLUG","yesTokenId":"0"}]
EOF

run_keeper() {
  MOCK_PRICES="$SLUG:$1" MARKETS_FILE=$MARKETS_FILE \
  RELAYER_PRIVATE_KEY=$TRADER_PK ORACLE_ADDRESS=$ORACLE ENGINE_ADDRESS=$ENGINE \
  RH_RPC=$RPC \
  node relayer/relayer.ts --once 2>&1 | sed 's/^/  /'
}

run_keeper 0.50
PRICE=$(cast call "$ORACLE" "price(bytes32)(uint256,uint256)" "$MARKET_ID" --rpc-url $RPC | head -1 | awk '{print $1}')
[[ "$PRICE" == "500000000000000000" ]] || fail "oracle price is $PRICE, expected 0.5e18"

log "Opening a 2x long: \$2.50 margin, \$5.00 size"
cast send "$USDG" "mint(address,uint256)" "$TRADER" 100000000 \
  --rpc-url $RPC --private-key $PK >/dev/null
cast send "$USDG" "approve(address,uint256)" "$ENGINE" \
  115792089237316195423570985008687907853269984665640564039457584007913129639935 \
  --rpc-url $RPC --private-key $TRADER_PK >/dev/null
cast send "$ENGINE" "openPosition(bytes32,bool,uint256,uint256)" \
  "$MARKET_ID" true 2500000 20000 --rpc-url $RPC --private-key $TRADER_PK >/dev/null

POS=$(cast call "$ENGINE" \
  "positions(uint256)(address,bytes32,bool,bool,uint128,uint128,uint128,uint128,uint128,uint128,uint128,uint64,uint64)" \
  1 --rpc-url $RPC)
ENTRY=$(echo "$POS" | sed -n '5p' | awk '{print $1}')
LIQ=$(echo "$POS" | sed -n '10p' | awk '{print $1}')
LOCKED=$(cast call "$VAULT" "lockedAssets()(uint256)" --rpc-url $RPC | awk '{print $1}')
echo "  entry     \$$(echo "scale=6; $ENTRY / 1000000000000000000" | bc)"
echo "  liq price \$$(echo "scale=6; $LIQ / 1000000000000000000" | bc)"
echo "  reserved  \$$(echo "scale=6; $LOCKED / 1000000" | bc)"
[[ "$ENTRY" == "505000000000000000" ]] || fail "entry price is $ENTRY, expected 0.505e18 after the 1% spread"
[[ "$LOCKED" != "0" ]] || fail "vault did not reserve any capital"

log "Checking the frontend's ABI against the deployment"
# The app hand-writes its ABI and encodes its own calldata, so nothing else in
# this run would notice a renamed function or a changed struct.
RPC=$RPC USDG=$USDG VAULT=$VAULT ENGINE=$ENGINE MARKET_ID=$MARKET_ID PK=$TRADER_PK \
  node script/frontend-abi-check.ts 2>&1 | sed 's/^/  /' \
  || fail "the frontend ABI does not match the deployed contracts"

# Measured from here rather than from the seeded $500: the ABI check above
# opens and closes its own position, so it leaves fees in the vault.
TVL_BEFORE=$(cast call "$VAULT" "totalAssets()(uint256)" --rpc-url $RPC | awk '{print $1}')

log "Walking the price down to \$0.25 — the oracle's 20% jump guard forces several steps"
for i in $(seq 1 8); do
  echo "  -- tick $((i + 1))"
  run_keeper 0.25
  OPEN=$(cast call "$ENGINE" "openPositionCount()(uint256)" --rpc-url $RPC | awk '{print $1}')
  [[ "$OPEN" == "0" ]] && break
done

log "Verifying the liquidation"
OPEN=$(cast call "$ENGINE" "openPositionCount()(uint256)" --rpc-url $RPC | awk '{print $1}')
[[ "$OPEN" == "0" ]] || fail "position still open after walking the price below the trigger"

IS_OPEN=$(cast call "$ENGINE" \
  "positions(uint256)(address,bytes32,bool,bool,uint128,uint128,uint128,uint128,uint128,uint128,uint128,uint64,uint64)" \
  1 --rpc-url $RPC | sed -n '4p' | awk '{print $1}')
[[ "$IS_OPEN" == "false" ]] || fail "position is not marked closed"

LOCKED=$(cast call "$VAULT" "lockedAssets()(uint256)" --rpc-url $RPC | awk '{print $1}')
[[ "$LOCKED" == "0" ]] || fail "reserved liquidity was not released, still $LOCKED"

ENGINE_BAL=$(cast call "$USDG" "balanceOf(address)(uint256)" "$ENGINE" --rpc-url $RPC | awk '{print $1}')
[[ "$ENGINE_BAL" == "0" ]] || fail "engine still holds $ENGINE_BAL USDG"

TVL=$(cast call "$VAULT" "totalAssets()(uint256)" --rpc-url $RPC | awk '{print $1}')
GAINED=$((TVL - TVL_BEFORE))
echo "  position closed by the keeper"
echo "  liquidity released, engine drained"
echo "  vault TVL \$$(echo "scale=6; $TVL / 1000000" | bc), up \$$(echo "scale=6; $GAINED / 1000000" | bc) on the liquidation"
# $2.425 of net margin. The other $0.075 of the trader's $2.50 reached the
# vault as the entry fee when the position opened.
[[ "$GAINED" == "2425000" ]] || fail "expected the vault to absorb 2.425000, got $GAINED"

printf '\n\033[1;32m✓ dry run passed\033[0m\n'
