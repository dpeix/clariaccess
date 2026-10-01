import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App.js";

describe("App", () => {
  it("renders a level-1 heading", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
  });
});
