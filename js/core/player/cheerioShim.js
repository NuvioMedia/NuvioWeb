// Minimal cheerio-compatible shim backed by the browser DOMParser (chrome 47 OK).
// Covers the jQuery-like subset that Nuvio scraper providers use:
// load(), $(sel), .text(), .html(), .attr(), .each(), .find(), .first(), .eq(),
// .map(), .parent(), .children(), .next(), .prev(), .toArray(), .length.

function wrap(nodes) {
  const arr = Array.prototype.slice.call(nodes || []);
  const self = {
    length: arr.length,
    nodes: arr,
    toArray() { return arr.slice(); },
    get(i) { return i == null ? arr.slice() : arr[i < 0 ? arr.length + i : i]; },
    eq(i) { const n = arr[i < 0 ? arr.length + i : i]; return wrap(n ? [n] : []); },
    first() { return wrap(arr.length ? [arr[0]] : []); },
    last() { return wrap(arr.length ? [arr[arr.length - 1]] : []); },
    text() {
      if (arguments.length) return self;
      return arr.map((n) => n.textContent || "").join("");
    },
    html() {
      if (arguments.length) return self;
      return arr.length ? (arr[0].innerHTML || "") : null;
    },
    attr(name) {
      if (!arr.length) return undefined;
      if (name == null) {
        const out = {}; const a = arr[0].attributes || [];
        for (let i = 0; i < a.length; i++) out[a[i].name] = a[i].value;
        return out;
      }
      return arr[0].getAttribute ? (arr[0].getAttribute(name) == null ? undefined : arr[0].getAttribute(name)) : undefined;
    },
    prop(name) { return arr.length ? arr[0][name] : undefined; },
    data(name) { return self.attr("data-" + name); },
    val() { return arr.length ? arr[0].value : undefined; },
    hasClass(c) { return arr.length ? arr[0].classList && arr[0].classList.contains(c) : false; },
    find(sel) {
      const out = [];
      arr.forEach((n) => { if (n.querySelectorAll) Array.prototype.forEach.call(n.querySelectorAll(sel), (m) => out.push(m)); });
      return wrap(out);
    },
    children(sel) {
      const out = [];
      arr.forEach((n) => Array.prototype.forEach.call(n.children || [], (c) => { if (!sel || (c.matches && c.matches(sel))) out.push(c); }));
      return wrap(out);
    },
    parent() { return wrap(arr.map((n) => n.parentNode).filter(Boolean)); },
    next() { return wrap(arr.map((n) => n.nextElementSibling).filter(Boolean)); },
    prev() { return wrap(arr.map((n) => n.previousElementSibling).filter(Boolean)); },
    closest(sel) { return wrap(arr.map((n) => (n.closest ? n.closest(sel) : null)).filter(Boolean)); },
    each(fn) { arr.forEach((n, i) => fn.call(n, i, n)); return self; },
    map(fn) { return wrap(arr.map((n, i) => fn.call(n, i, n))); },
    filter(sel) {
      if (typeof sel === "function") return wrap(arr.filter((n, i) => sel.call(n, i, n)));
      return wrap(arr.filter((n) => n.matches && n.matches(sel)));
    },
    is(sel) { return arr.some((n) => n.matches && n.matches(sel)); }
  };
  return self;
}

export const CheerioShim = {
  load(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const $ = function (selector) {
      if (!selector) return wrap([]);
      if (typeof selector === "object") return wrap(selector.nodes || [selector]);
      let found;
      try { found = doc.querySelectorAll(selector); } catch (e) { found = []; }
      return wrap(found);
    };
    $.root = function () { return wrap([doc.documentElement]); };
    $.html = function (node) {
      if (node && node.nodes) return node.nodes.length ? node.nodes[0].outerHTML : "";
      return doc.documentElement ? doc.documentElement.outerHTML : "";
    };
    $.text = function () { return doc.body ? doc.body.textContent : ""; };
    return $;
  }
};
