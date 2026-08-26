/** UI estimate only. Live settlement is `runLiveTrade`. */
export const PUSD_PER_USDG = 1;

export function quoteConversion(usdg: number) {
  const amount = Number.isFinite(usdg) ? Math.max(0, usdg) : 0;
  const pusd = Math.round(amount * PUSD_PER_USDG * 100) / 100;
  return {
    usdg: Math.round(amount * 100) / 100,
    pusd,
    rate: PUSD_PER_USDG,
    feeUsdg: 0,
  };
}
