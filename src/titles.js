"use strict";
var TagWorkspaceTitles = (() => {
  const tokenPattern = () => /<\/?(?:sub|sup|i|em|b|strong|u|s|small|span)(?:\s[^<>]*?)?\s*>/gi;
  const decoders = new WeakMap();
  function decode(doc, text) {
    let decoder = decoders.get(doc);
    if (!decoder) {
      const inert = doc.implementation.createHTMLDocument("");
      decoder = inert.createElement("textarea"); decoders.set(doc, decoder);
    }
    // Only character references enter this inert, detached decoder. Escape all
    // literal brackets first so neither end tags nor active elements can parse.
    decoder.innerHTML = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return decoder.textContent;
  }
  function plain(doc, value) { return decode(doc, String(value || "").replace(tokenPattern(), "")); }
  function fragment(doc, value) {
    const result = doc.createDocumentFragment();
    const stack = [{ name: "", node: result }];
    const source = String(value || "");
    let offset = 0;
    const appendText = text => stack[stack.length - 1].node.append(doc.createTextNode(decode(doc, text)));
    for (const match of source.matchAll(tokenPattern())) {
      appendText(source.slice(offset, match.index)); offset = match.index + match[0].length;
      const name = /^<\/?(\w+)/.exec(match[0])[1].toLowerCase();
      if (match[0].startsWith("</")) {
        const at = stack.map(entry => entry.name).lastIndexOf(name);
        if (at > 0) stack.length = at;
      } else {
        const node = doc.createElementNS("http://www.w3.org/1999/xhtml", name);
        // Copy no attributes. Support only Zotero's small-caps presentation.
        if (name === "span" && /(?:small-caps|class\s*=\s*["'](?:smallcaps|sc)["'])/i.test(match[0])) node.className = "title-smallcaps";
        stack[stack.length - 1].node.append(node);
        if (stack.length < 32) stack.push({ name, node });
      }
    }
    appendText(source.slice(offset));
    return result;
  }
  return { plain, fragment };
})();
