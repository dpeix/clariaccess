import type { CSSProperties, ReactNode } from "react";

// Not `display: none`: that would also hide the content from screen readers.
const visuallyHiddenStyle: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span style={visuallyHiddenStyle}>{children}</span>;
}
