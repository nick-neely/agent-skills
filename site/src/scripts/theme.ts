import { site } from "../lib/site-theme.ts";

type Theme = "dark" | "light";

function apply(theme: Theme) {
  const root = document.documentElement;
  // Without this a switch paints some elements mid-transition in the old theme.
  root.classList.add("theme-switching");
  root.classList.toggle("dark", theme === "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", site.themeColors[theme]);
  document.getElementById("site-favicon")?.setAttribute("href", site.favicons[theme]);
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // Storage can be unavailable; the theme still applies to this page.
  }
  void root.offsetWidth;
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element) || !event.target.closest("[data-theme-toggle]")) return;
  apply(document.documentElement.classList.contains("dark") ? "light" : "dark");
});
