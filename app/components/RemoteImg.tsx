export function RemoteImg({
  src,
  alt = "",
  className,
  size,
  eager = false,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  size: number;
  eager?: boolean;
}) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={eager ? "high" : "low"}
      draggable={false}
    />
  );
}
