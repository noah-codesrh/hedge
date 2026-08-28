/** The bottom sheet on mobile, centred dialog above it, used by every modal. */
export function ModalShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 animate-fade-in sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-t-[28px] border border-white/10 bg-[#161616] p-5 shadow-2xl animate-pop-in sm:rounded-[28px] sm:p-6">
        {children}
      </div>
    </div>
  );
}
