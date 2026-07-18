function supportsScrollIntoViewOptions() {
  return Boolean(
    typeof document !== "undefined" &&
      document.documentElement &&
      "scrollBehavior" in document.documentElement.style
  );
}

export default function scrollIntoView(target, options = {}) {
  if (!target) {
    return;
  }

  if (supportsScrollIntoViewOptions() && typeof target.scrollIntoView === "function") {
    target.scrollIntoView(options);
    return;
  }

  const block = options?.block || "start";
  const inline = options?.inline || "nearest";
  if (
    block === "nearest" &&
    inline === "nearest" &&
    typeof target.scrollIntoViewIfNeeded === "function"
  ) {
    target.scrollIntoViewIfNeeded(false);
    return;
  }

  if (typeof target.scrollIntoView === "function") {
    target.scrollIntoView(block !== "end");
  }
}