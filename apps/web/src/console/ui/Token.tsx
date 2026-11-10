export type Token = "USDC" | "NEAR";

const SRC: Record<Token, string> = {
  USDC: "/images/usd-coin-usdc-logo.svg",
  NEAR: "/images/near-protocol-near-logo.svg",
};

/** The token's own mark in place of its ticker. The alt text keeps the word for screen readers and text search. */
export function TokenIcon({ t = "USDC", className = "" }: { t?: Token; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={SRC[t]} alt={t} title={t} width={24} height={24} className={`block size-6 ${className}`} />
  );
}
