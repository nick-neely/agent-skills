import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://skills.nickneely.dev",
  output: "static",
  // Matches vercel.json, which redirects a trailing slash away. Pages still build
  // as directories, which Vercel serves at the slash-less path.
  trailingSlash: "never",
  build: { format: "directory" },
  devToolbar: { enabled: false },
  integrations: [react()],
});
