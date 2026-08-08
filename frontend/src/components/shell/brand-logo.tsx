import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  /** Show wordmark next to camel. Default true. */
  showWordmark?: boolean;
  href?: string;
};

export function BrandLogo({
  className,
  showWordmark = true,
  href = "/runs",
}: Props) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 text-foreground no-underline transition-opacity hover:opacity-90",
        className,
      )}
      aria-label="TUNTAS home"
    >
      <Image
        src="/camel-logo.png"
        alt=""
        width={36}
        height={59}
        className="h-9 w-auto object-contain"
        priority
      />
      {showWordmark ? (
        <span className="font-display text-2xl tracking-tight">TUNTAS</span>
      ) : null}
    </Link>
  );
}
