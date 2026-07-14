import { describe, expect, it } from "vitest";

import { htmlToText } from "../src/html.js";

describe("source HTML normalization", () => {
  it("keeps table cells readable and decodes common menu entities", () => {
    expect(
      htmlToText(
        "<table><tr><td>Kassleria</td><td></td><td>13.50 &euro;</td></tr>" +
          "<tr><td>Uunifetabroilerpasta</td><td>L</td></tr></table>",
      ),
    ).toBe("Kassleria | 13.50 €\nUunifetabroilerpasta | L");
  });
});
