import { useEffect, type ReactNode } from "react";
import { siteTitle } from "../lib/title.js";

export function useTitle(title: string): void {
  useEffect(() => {
    document.title = siteTitle(title);
  }, [title]);
}

// Announced politely when it appears; use `alert` for errors.
export function Status({ children }: { children: ReactNode }) {
  return <p role="status">{children}</p>;
}

export function ErrorMessage({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <p id={id} role="alert" className="error">
      {children}
    </p>
  );
}
