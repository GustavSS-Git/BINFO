import type { ReactNode } from "react";
import { Card, PageHeader } from "@/components/ui/binfo";

/** Gemensam ram för konto-sidorna (samma mönster som övriga sidor: smal kolumn + Card). */
export function AuthSida({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md px-5 py-14">
      <PageHeader
        {...(eyebrow !== undefined ? { eyebrow } : {})}
        title={title}
        {...(lead !== undefined ? { lead } : {})}
      />
      <Card>{children}</Card>
    </div>
  );
}

/** Felruta i samma stil som på /vardering. Serverns text visas ordagrant. */
export function FelRuta({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger/5 p-4" role="alert">
      <p className="text-sm text-foreground">{children}</p>
    </div>
  );
}

/** Bekräftelseruta (neutral), t.ex. "Sparad". */
export function InfoRuta({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-primary/25 bg-primary/[0.05] p-4" role="status">
      <div className="space-y-2 text-sm text-foreground">{children}</div>
    </div>
  );
}
