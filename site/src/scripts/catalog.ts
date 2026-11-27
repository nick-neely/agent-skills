// The catalog filter: type to narrow by name or summary, "/" to focus, Escape
// to clear, ArrowDown into the results, Enter to open the first match.

const root = document.querySelector<HTMLElement>("[data-catalog]");
const input = root?.querySelector<HTMLInputElement>("[data-filter]");

if (root && input) {
  const rows = [...root.querySelectorAll<HTMLElement>("[data-row]")];
  const state = { query: "", kind: "all" };

  const matches = (row: HTMLElement) => {
    const workflow = row.dataset.kind === "workflow";
    if (state.kind === "workflow" && !workflow) return false;
    if (state.kind === "skill" && workflow) return false;
    const hay = row.dataset.hay ?? "";
    return state.query.trim().toLowerCase().split(/\s+/).filter(Boolean).every((term) => hay.includes(term));
  };

  const apply = () => {
    const filtering = Boolean(state.query.trim()) || state.kind !== "all";
    let shown = 0;
    for (const row of rows) {
      row.hidden = !matches(row);
      if (!row.hidden) shown++;
    }
    for (const section of root.querySelectorAll<HTMLElement>("[data-category]")) {
      const total = Number(section.dataset.total);
      const visible = section.querySelectorAll("[data-row]:not([hidden])").length;
      section.hidden = visible === 0;
      const count = section.querySelector("[data-category-count]");
      if (count) count.textContent = filtering ? `${visible} of ${total}` : `${total} skill${total === 1 ? "" : "s"}`;
      const rail = root.querySelector<HTMLElement>(`[data-rail-item="${section.dataset.category}"]`);
      if (rail) {
        rail.hidden = visible === 0;
        const n = rail.querySelector("[data-rail-count]");
        if (n) n.textContent = String(visible);
      }
    }
    const count = root.querySelector("[data-filter-count]");
    if (count) count.textContent = `${shown} of ${rows.length}`;
    const empty = root.querySelector<HTMLElement>("[data-empty]");
    if (empty) empty.hidden = shown > 0;
    const query = root.querySelector("[data-empty-query]");
    if (query) query.textContent = state.query;
    root.querySelectorAll<HTMLElement>("[data-kind-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kindFilter === state.kind)));
  };

  const visibleNames = () => rows.filter((r) => !r.hidden).map((r) => r.querySelector<HTMLAnchorElement>(".name")).filter((a): a is HTMLAnchorElement => a !== null);

  input.addEventListener("input", () => {
    state.query = input.value;
    apply();
  });

  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const kind = event.target.closest<HTMLElement>("[data-kind-filter]");
    if (kind) {
      state.kind = kind.dataset.kindFilter ?? "all";
      apply();
    } else if (event.target.closest("[data-clear]")) {
      state.query = "";
      state.kind = "all";
      input.value = "";
      apply();
      input.focus();
    }
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable;
    if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      input.focus({ preventScroll: true });
      input.scrollIntoView({ block: "center" });
      input.select();
      return;
    }
    if (target === input) {
      if (event.key === "Escape") {
        const had = input.value;
        input.value = "";
        state.query = "";
        apply();
        if (!had) input.blur();
      } else if (event.key === "Enter") {
        const first = visibleNames()[0];
        if (first) location.href = first.href;
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        visibleNames()[0]?.focus();
      }
      return;
    }
    if (target.classList.contains("name") && root.contains(target) && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const list = visibleNames();
      const next = list.indexOf(target as HTMLAnchorElement) + (event.key === "ArrowDown" ? 1 : -1);
      if (next < 0) input.focus();
      else list[Math.min(next, list.length - 1)]?.focus();
    }
  });
}
