// Marks the section in view in a sticky section list. Highlight only: jumps
// are plain anchors and nothing animates on scroll.

for (const nav of document.querySelectorAll<HTMLElement>("[data-section-nav]")) {
  const links = [...nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
  const targets = links.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter((t): t is HTMLElement => t !== null);
  if (!targets.length || !("IntersectionObserver" in window)) continue;
  const inView = new Set<Element>();
  const mark = () => {
    const current = targets.find((t) => inView.has(t) && !t.hidden);
    if (!current) return;
    for (const a of links) {
      if (a.hash === `#${current.id}`) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    }
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) inView.add(e.target);
        else inView.delete(e.target);
      }
      mark();
    },
    { rootMargin: "-15% 0px -55% 0px" },
  );
  targets.forEach((t) => observer.observe(t));
}
