// Highlights a node's edges while the reader points at it, or focuses its
// entry in the list that stands in for the drawing. Reader-triggered only.

function clear(graph: Element) {
  graph.removeAttribute("data-hover");
  graph.querySelectorAll(".hot").forEach((el) => el.classList.remove("hot"));
}

function highlight(event: Event) {
  if (!(event.target instanceof Element)) return;
  const graph = event.target.closest("[data-graph]");
  document.querySelectorAll("[data-graph][data-hover]").forEach((g) => g !== graph && clear(g));
  if (!graph) return;
  const id = event.target.closest<SVGGElement>(".dg-node")?.dataset.id ?? event.target.closest<HTMLElement>("[data-graph-id]")?.dataset.graphId;
  clear(graph);
  if (!id) return;
  const node = (key: string) => graph.querySelector(`.dg-node[data-id="${CSS.escape(key)}"]`);
  graph.setAttribute("data-hover", "");
  node(id)?.classList.add("hot");
  graph.querySelectorAll<SVGPathElement>(`.dg-edge[data-from="${CSS.escape(id)}"], .dg-edge[data-to="${CSS.escape(id)}"]`).forEach((edge) => {
    edge.classList.add("hot");
    node(edge.dataset.from === id ? (edge.dataset.to ?? "") : (edge.dataset.from ?? ""))?.classList.add("hot");
  });
}

document.addEventListener("mouseover", highlight);
document.addEventListener("focusin", highlight);
