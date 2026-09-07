const MARK =
  "M40.95 76.61V100L2.6 75.12l17.88-10.3 20.47 11.79Zm42.45-1.5L45.05 100V76.61l20.48-11.79 17.88 10.3ZM63.48 38.05v23.59L43 73.43 22.52 61.64V38.05L43 26.26l20.48 11.79ZM18.43 38.05v23.59L0 72.25V27.43l18.43 10.62ZM86 72.25 67.57 61.64V38.05L86 27.43v44.82ZM40.95 23.49 20.48 35.28 0 23.49V0h40.95v23.49ZM86 23.49 65.52 35.28 45.05 23.49V0H86v23.49Z";

function Mark({ fill, className }: { fill: string; className?: string }) {
  return (
    <svg viewBox="0 0 86 100" className={className} aria-hidden>
      <path d={MARK} fill={fill} />
    </svg>
  );
}

function Hex({
  cx,
  cy,
  r,
  fill,
  stroke,
  strokeWidth = 1.5,
}: {
  cx: number;
  cy: number;
  r: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}) {
  const points = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(" ");
  return (
    <polygon
      points={points}
      fill={fill ?? "none"}
      stroke={stroke}
      strokeWidth={strokeWidth}
    />
  );
}

const TILE = "h-[4.75rem] w-[4.75rem] shrink-0 overflow-hidden rounded-2xl ring-1 ring-white/10 sm:h-24 sm:w-24";

export function ArtYesNo() {
  return (
    <svg viewBox="0 0 96 96" className={TILE} aria-hidden>
      <rect width="96" height="96" fill="#1c1c1c" />
      <rect x="8" y="28" width="36" height="40" rx="10" fill="#f1d65a" />
      <rect x="52" y="28" width="36" height="40" rx="10" fill="#252525" />
      <rect x="52" y="28" width="36" height="40" rx="10" fill="none" stroke="#333" />
      <g transform="translate(33 28) scale(0.35)">
        <Mark fill="#141414" />
      </g>
    </svg>
  );
}

export function ArtLeverage() {
  return (
    <svg viewBox="0 0 96 96" className={TILE} aria-hidden>
      <rect width="96" height="96" fill="#1c1c1c" />
      <g transform="translate(48 50)">
        <Hex cx={0} cy={0} r={34} stroke="#f1d65a" strokeWidth="1.25" />
        <Hex cx={0} cy={0} r={24} stroke="#f1d65a" strokeWidth="1.25" />
        <Hex cx={0} cy={0} r={14} fill="#f1d65a" />
      </g>
      <g transform="translate(40.5 40) scale(0.175)">
        <Mark fill="#141414" />
      </g>
    </svg>
  );
}

export function ArtDeposit() {
  return (
    <svg viewBox="0 0 96 96" className={TILE} aria-hidden>
      <rect width="96" height="96" fill="#1c1c1c" />
      <circle cx="22" cy="28" r="6" fill="#627EEA" />
      <circle cx="74" cy="28" r="6" fill="#0052FF" />
      <circle cx="22" cy="70" r="6" fill="#F0B90B" />
      <circle cx="74" cy="70" r="6" fill="#9945FF" />
      <path
        d="M28 30c8 4 12 10 20 14M68 30c-8 4-12 10-20 14M28 68c8-4 12-10 20-14M68 68c-8-4-12-10-20-14"
        fill="none"
        stroke="#f1d65a"
        strokeOpacity="0.45"
        strokeWidth="1.5"
      />
      <circle cx="48" cy="48" r="16" fill="#f1d65a" />
      <g transform="translate(41.2 38.5) scale(0.16)">
        <Mark fill="#141414" />
      </g>
    </svg>
  );
}
