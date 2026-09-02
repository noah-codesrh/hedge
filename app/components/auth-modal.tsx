import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const OPEN_KEY = "hedge-auth-open";

function readOpen() {
  try {
    return sessionStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOpen(open: boolean) {
  try {
    if (open) sessionStorage.setItem(OPEN_KEY, "1");
    else sessionStorage.removeItem(OPEN_KEY);
  } catch {
    /* private mode */
  }
}

interface AuthModalCtx {
  open: boolean;
  /** True while Privy's own wallet picker should sit above our sheet. */
  walletLayer: boolean;
  openModal: () => void;
  closeModal: () => void;
  openWalletLayer: () => void;
  closeWalletLayer: () => void;
}

const AuthModalContext = createContext<AuthModalCtx | null>(null);

export function useAuthModal(): AuthModalCtx {
  const ctx = useContext(AuthModalContext);
  if (!ctx) throw new Error("useAuthModal must be used within <Providers>");
  return ctx;
}

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(readOpen);
  const [walletLayer, setWalletLayer] = useState(false);

  const openModal = useCallback(() => {
    writeOpen(true);
    setOpen(true);
  }, []);
  const closeModal = useCallback(() => {
    writeOpen(false);
    setWalletLayer(false);
    setOpen(false);
  }, []);
  const openWalletLayer = useCallback(() => setWalletLayer(true), []);
  const closeWalletLayer = useCallback(() => setWalletLayer(false), []);

  const value = useMemo(
    () => ({
      open,
      walletLayer,
      openModal,
      closeModal,
      openWalletLayer,
      closeWalletLayer,
    }),
    [open, walletLayer, openModal, closeModal, openWalletLayer, closeWalletLayer],
  );

  return (
    <AuthModalContext.Provider value={value}>
      {children}
    </AuthModalContext.Provider>
  );
}
