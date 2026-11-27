// The hero demo's words, shared by the static frame (HeroDemo.astro) and the
// animated island (HeroDemoLive.tsx), so the two can never disagree. Every
// claim here is also made in the page's own text; the numbers are an example.
export const request = "Implement #142, export filtered reports as CSV. Full stop.";

export const proofTitle = "What this must prove";

export const proof = [
  "the export holds exactly the filtered rows",
  "an empty filter exports the header row only",
  "the button reads clearly on the reports page",
] as const;

/** Each check as it runs (`pending`) and as it lands (`detail`). */
export const steps = [
  { label: "tests", pending: "running", detail: "14 passed, 3 new" },
  { label: "flow-walk", pending: "walking the flow", detail: "reports to export, no friction" },
  { label: "review", pending: "in review", detail: "4 comments resolved" },
  { label: "PR #318", pending: "opening", detail: "filed with UI evidence" },
  { label: "CI", pending: "running", detail: "all checks green" },
] as const;

export const result = "Ready for you to merge.";
