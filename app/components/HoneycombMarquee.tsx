const TILES = 8;

/**
 * Three columns of logomarks on gold honeycomb, scrolling in opposite
 * directions — the login-modal header treatment from the example app,
 * using Hedge brand instead of sports photography.
 */
export function HoneycombMarquee({ columns = 3 }: { columns?: number }) {
  const tiles = Array.from({ length: TILES }, (_, i) => i);

  return (
    <div className="honeycomb flex h-full gap-2.5 overflow-hidden">
      {Array.from({ length: columns }, (_, col) => {
        const doubled = [...tiles, ...tiles];
        const up = col % 2 === 0;
        return (
          <div key={col} className="flex-1 overflow-hidden">
            <div
              className={up ? "animate-marquee-up" : "animate-marquee-down"}
              style={{ animationDuration: `${22 + col * 5}s` }}
            >
              {doubled.map((_, j) => (
                <div
                  key={`${col}-${j}`}
                  className="mb-2.5 grid h-28 place-items-center rounded-xl bg-black/10"
                >
                  <img
                    src="/logo-mark-dark.svg"
                    alt=""
                    className="h-10 w-auto opacity-35"
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
