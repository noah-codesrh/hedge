import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ENV } from "../lib/env";
import { LoginModal } from "./LoginModal";
import { BookProvider } from "./Book";

const PrivyRoot = lazy(() => import("./PrivyRoot"));

interface AuthModalCtx {
  open: boolean;
  openModal: () => void;
  closeModal: () => void;
}

const AuthModalContext = createContext<AuthModalCtx | null>(null);
const PrivyMountedContext = createContext(false);

export function useAuthModal(): AuthModalCtx {
  const ctx = useContext(AuthModalContext);
  if (!ctx) throw new Error("useAuthModal must be used within <Providers>");
  return ctx;
}

export function usePrivyMounted() {
  return useContext(PrivyMountedContext);
}

function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openModal = useCallback(() => setOpen(true), []);
  const closeModal = useCallback(() => setOpen(false), []);
  const value = useMemo(
    () => ({ open, openModal, closeModal }),
    [open, openModal, closeModal],
  );

  return (
    <AuthModalContext.Provider value={value}>
      {children}
      <LoginModal open={open} onClose={closeModal} />
    </AuthModalContext.Provider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [privyMounted, setPrivyMounted] = useState(false);

  useEffect(() => {
    if (ENV.privyAppId) setPrivyMounted(true);
  }, []);

  const guest = <AuthModalProvider>{children}</AuthModalProvider>;
  const signed = (
    <AuthModalProvider>
      <BookProvider>{children}</BookProvider>
    </AuthModalProvider>
  );

  if (!privyMounted) {
    return (
      <PrivyMountedContext.Provider value={false}>
        {guest}
      </PrivyMountedContext.Provider>
    );
  }

  return (
    <PrivyMountedContext.Provider value>
      <Suspense fallback={guest}>
        <PrivyRoot>{signed}</PrivyRoot>
      </Suspense>
    </PrivyMountedContext.Provider>
  );
}
