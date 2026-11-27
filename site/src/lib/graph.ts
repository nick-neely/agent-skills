// The dependency graph for a workflow, laid out at build time as static SVG,
// plus the indented list that stands in for it on narrow screens and for
// screen readers. Edges come from metadata.requires and metadata.uses in each
// installed SKILL.md, limited to what the workflow installs or omits.

import { catalog, externalURL, ref, skillPath, type EdgeKind, type Skill } from "./catalog.ts";
import { escapeHTML } from "./html.ts";

interface Edge {
  from: string;
  to: string;
  kind: EdgeKind;
}

function model(workflow: Skill) {
  const pack = workflow.pack;
  if (!pack) throw new Error(`${workflow.name} has no Pack`);
  const installed = new Set(pack.members.map((m) => m.id));
  const omitted = new Set(pack.omitted.map((m) => m.id));
  const local = new Map(catalog().skills.map((s) => [s.name, s]));
  const edges: Edge[] = [];
  for (const id of installed) {
    const skill = local.get(id);
    if (!skill) continue;
    for (const kind of ["requires", "uses"] as const) {
      for (const to of skill[kind]) if (installed.has(to) || omitted.has(to)) edges.push({ from: id, to, kind });
    }
  }
  // Longest-path layering from the workflow, so every edge points rightwards.
  const depth = new Map<string, number>([[workflow.name, 0]]);
  for (let changed = true, pass = 0; changed && pass < 64; pass++) {
    changed = false;
    for (const e of edges) {
      const from = depth.get(e.from);
      if (from !== undefined && (depth.get(e.to) ?? -1) < from + 1) {
        depth.set(e.to, from + 1);
        changed = true;
      }
    }
  }
  const all = [...installed, ...omitted];
  const deepest = Math.max(0, ...depth.values());
  for (const id of all) if (!depth.has(id)) depth.set(id, deepest + 1);
  return { edges, depth, all, omitted };
}

const label = (id: string) => ref(id).name;
const href = (id: string) => (ref(id).local ? skillPath(id) : externalURL(id));

export interface GraphMarkup {
  svg: string;
  tree: string;
}

export function dependencyGraph(workflow: Skill): GraphMarkup {
  const { edges, depth, all, omitted } = model(workflow);
  const columns: string[][] = [];
  for (const id of all) (columns[depth.get(id)!] ??= []).push(id);

  // Order each column by the mean row of its neighbours, sweeping both ways,
  // to cut edge crossings.
  const rows = () => {
    const r = new Map<string, number>();
    columns.forEach((col) => col?.forEach((id, i) => r.set(id, i)));
    return r;
  };
  for (let pass = 0; pass < 6; pass++) {
    const down = pass % 2 === 0;
    const order = columns.map((_, i) => (down ? i : columns.length - 1 - i));
    for (const index of order) {
      const col = columns[index];
      if (!col || index === 0) continue;
      const r = rows();
      const score = new Map(
        col.map((id) => {
          const d = depth.get(id)!;
          const neighbours = edges
            .filter((e) => (down ? e.to === id && depth.get(e.from)! < d : e.from === id && depth.get(e.to)! > d))
            .map((e) => r.get(down ? e.from : e.to)!);
          return [id, neighbours.length ? neighbours.reduce((a, b) => a + b, 0) / neighbours.length : r.get(id)!];
        }),
      );
      col.sort((a, b) => score.get(a)! - score.get(b)!);
    }
  }

  const nodeWidth = (id: string) => Math.round(label(id).length * 7.4 + 26);
  const rowHeight = 38;
  const columnGap = 54;
  const pad = 8;
  const tallest = Math.max(...columns.map((c) => c?.length ?? 0));
  const pos = new Map<string, { x: number; y: number; w: number }>();
  let x = pad;
  for (const col of columns) {
    if (!col) continue;
    const width = Math.max(...col.map(nodeWidth));
    const offset = ((tallest - col.length) * rowHeight) / 2;
    col.forEach((id, i) => pos.set(id, { x, y: pad + offset + i * rowHeight, w: nodeWidth(id) }));
    x += width + columnGap;
  }
  const width = x - columnGap + pad;
  const height = tallest * rowHeight + pad * 2;

  const attr = escapeHTML;
  const edgeMarkup = edges
    .map((e) => {
      const a = pos.get(e.from)!;
      const b = pos.get(e.to)!;
      const x1 = a.x + a.w;
      const y1 = a.y + 13;
      const x2 = b.x;
      const y2 = b.y + 13;
      const mx = (x1 + x2) / 2;
      return `<path class="dg-edge ${e.kind}" data-from="${attr(e.from)}" data-to="${attr(e.to)}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
    })
    .join("");
  const nodeMarkup = all
    .map((id) => {
      const p = pos.get(id)!;
      const classes = ["dg-node", id === workflow.name && "root", !ref(id).local && "ext", omitted.has(id) && "omit"].filter(Boolean).join(" ");
      // The list below is the keyboard and screen reader route through the
      // graph, so the drawing's links stay pointer-only.
      return `<a href="${attr(href(id))}" tabindex="-1"${ref(id).local ? "" : ' rel="noreferrer"'}><g class="${classes}" data-id="${attr(id)}"><rect x="${p.x}" y="${p.y}" width="${p.w}" height="26" rx="5"/><text x="${p.x + 13}" y="${p.y + 17}">${escapeHTML(label(id))}</text></g></a>`;
    })
    .join("");
  const svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false">${edgeMarkup}${nodeMarkup}</svg>`;

  const seen = new Set<string>();
  const walk = (id: string, kind?: EdgeKind): string => {
    const r = ref(id);
    const name = r.local
      ? `<a class="lu" href="${attr(href(id))}" data-graph-id="${attr(id)}">${escapeHTML(r.name)}</a>`
      : `<a class="lu" href="${attr(href(id))}" rel="noreferrer" data-graph-id="${attr(id)}">${escapeHTML(r.name)}</a><span class="k">${escapeHTML(r.repo)}</span>`;
    const relation = kind ? `<span class="k">${kind === "uses" ? "uses on some paths" : "requires"}${omitted.has(id) ? ", not installed" : ""}</span>` : "";
    if (seen.has(id)) return `<li>${name}${relation}<span class="k">(listed above)</span></li>`;
    seen.add(id);
    const children = edges.filter((e) => e.from === id);
    return `<li>${name}${relation}${children.length ? `<ul>${children.map((e) => walk(e.to, e.kind)).join("")}</ul>` : ""}</li>`;
  };
  const top = walk(workflow.name);
  // Members nothing here names still install with the workflow.
  const loose = all.filter((id) => !seen.has(id)).map((id) => walk(id));
  const tree = `<ul>${top}${loose.join("")}</ul>`;
  return { svg, tree };
}
