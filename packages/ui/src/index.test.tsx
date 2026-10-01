import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VisuallyHidden } from "./index.js";

describe("VisuallyHidden", () => {
  it("renders its children in a span hidden visually but kept for screen readers", () => {
    const html = renderToStaticMarkup(
      <VisuallyHidden>Nouvelle fenêtre</VisuallyHidden>,
    );

    expect(html).toContain("Nouvelle fenêtre");
    expect(html).toContain("<span");
    expect(html).toContain("clip");
    expect(html).not.toContain("display:none");
  });
});
