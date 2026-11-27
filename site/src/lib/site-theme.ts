// Shared by the build and the browser, so it imports nothing that reads files.
export const site = {
  /** Browser UI colour per theme: the hex of each theme's --background, as on nickneely.dev. */
  themeColors: { dark: "#0e0b08", light: "#f8f7f3" },
  favicons: { dark: "/favicon-dark.png", light: "/favicon-light.png" },
} as const;

/**
 * Runs blocking in <head> so the theme is on <html> before the first paint: a
 * stored choice first, then the system preference, then the dark default. It
 * also marks that scripts run, which is what reveals controls that need them.
 */
export const themeScript = `(()=>{const d=document.documentElement;d.classList.add("js");let t;try{const s=localStorage.getItem("theme");if(s==="light"||s==="dark")t=s}catch(e){}if(!t)t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";d.classList.toggle("dark",t==="dark");document.querySelector('meta[name="theme-color"]')?.setAttribute("content",t==="dark"?${JSON.stringify(site.themeColors.dark)}:${JSON.stringify(site.themeColors.light)});document.getElementById("site-favicon")?.setAttribute("href",t==="dark"?${JSON.stringify(site.favicons.dark)}:${JSON.stringify(site.favicons.light)})})();`;
