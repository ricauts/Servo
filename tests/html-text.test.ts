import { describe, expect, it } from "vitest";
import { decodeEntities, htmlTitle, htmlToText } from "@/lib/html-text";

describe("decodeEntities", () => {
  it("decodes the named entities pages actually use", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &nbsp;e&hellip;")).toBe(
      'a & b <c> "d"  e…',
    );
  });

  it("decodes decimal and hex numeric references", () => {
    expect(decodeEntities("&#65;&#x42;&#x1F600;")).toBe("AB😀");
  });

  it("leaves anything it does not recognise alone", () => {
    expect(decodeEntities("&notareal; &#x110000;")).toBe("&notareal; &#x110000;");
  });
});

describe("htmlTitle", () => {
  it("returns the decoded, collapsed document title", () => {
    expect(htmlTitle("<html><head><title>Status &amp;\n  incidents</title></head></html>")).toBe(
      "Status & incidents",
    );
  });

  it("returns empty when there is no title", () => {
    expect(htmlTitle("<html><body>hi</body></html>")).toBe("");
  });
});

describe("htmlToText", () => {
  it("drops script, style and comments instead of reading them aloud", () => {
    const html = `
      <html><head><style>body{color:red}</style></head>
      <body><!-- hidden --><script>var x = "not prose";</script>
      <p>All systems operational.</p></body></html>`;
    const text = htmlToText(html);
    expect(text).toBe("All systems operational.");
  });

  it("keeps headings, list items and paragraph breaks", () => {
    const html =
      "<h1>Incident</h1><p>API errors.</p><ul><li>Login</li><li>Search</li></ul><h2>Fix</h2><p>Rolled back.</p>";
    expect(htmlToText(html)).toBe(
      "# Incident\nAPI errors.\n\n- Login\n- Search\n\n## Fix\nRolled back.",
    );
  });

  it("keeps a link's target next to its text so it can be followed", () => {
    expect(htmlToText('<p>See the <a href="https://example.com/rn">release notes</a>.</p>')).toBe(
      "See the release notes (https://example.com/rn).",
    );
  });

  it("drops in-page and javascript hrefs but keeps their text", () => {
    expect(htmlToText('<a href="#top">Top</a> <a href="javascript:void(0)">Menu</a>')).toBe(
      "Top Menu",
    );
  });

  it("uses the href when the anchor has no text", () => {
    expect(htmlToText('<a href="https://example.com/x"><img src="i.png"></a>')).toBe(
      "https://example.com/x",
    );
  });

  it("separates table cells", () => {
    expect(htmlToText("<table><tr><td>API</td><td>Degraded</td></tr></table>")).toBe(
      "| API | Degraded",
    );
  });

  it("survives a body truncated mid-script", () => {
    expect(htmlToText("<p>Visible.</p><script>var secret = 'unclo")).toBe("Visible.");
  });

  it("collapses runaway whitespace and blank lines", () => {
    expect(htmlToText("<p>a</p>\n\n\n\n<p>b</p>   <p>   </p><p>c</p>")).toBe("a\n\nb\n\nc");
  });

  it("returns plain text unchanged when there is no markup", () => {
    expect(htmlToText("Just a sentence.")).toBe("Just a sentence.");
  });
});
