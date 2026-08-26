import { useEffect, useState } from "react";
import { useFetchers, useNavigation } from "react-router";

export function TopProgress() {
  const navigation = useNavigation();
  const fetchers = useFetchers();
  const pending =
    navigation.state !== "idle" || fetchers.some((f) => f.state !== "idle");

  const [shown, setShown] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (pending) {
      setShown(true);
      setFinishing(false);
      return;
    }
    if (!shown) return;
    setFinishing(true);
    const t = window.setTimeout(() => {
      setShown(false);
      setFinishing(false);
    }, 240);
    return () => window.clearTimeout(t);
  }, [pending, shown]);

  if (!shown) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-[3px] overflow-hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={finishing ? 100 : 70}
      aria-hidden={!pending}
    >
      <div
        className={`h-full bg-gold shadow-[0_0_12px_#f1d65a] ${
          finishing ? "hedge-topbar-finish" : "hedge-topbar-run"
        }`}
      />
    </div>
  );
}
