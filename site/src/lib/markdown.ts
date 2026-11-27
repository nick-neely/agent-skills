import { posix } from "node:path";

import { Marked, type Tokens } from "marked";
import { bundledLanguages, createCssVariablesTheme, createHighlighter } from "shiki";

import { escapeHTML } from "./html.ts";
import { REPOSITORY_URL } from "./catalog.ts";

/**
 * Shiki resolves every token to a `--code-*` custom property, the warm palette
 * nickneely.dev uses, so one highlighted tree serves both themes. The name is
 * written onto each `<pre>` as a class, so it must not collide with any other.
 */
const codeTheme = createCssVariablesTheme({ name: "skills-code", variablePrefix: "--code-", fontStyle: true });
const languages = ["bash", "sh", "shell", "json", "yaml", "markdown", "md", "javascript", "typescript", "python", "diff"];
const highlighter = await createHighlighter({ themes: [codeTheme], langs: languages });

const isRelative = (href: string) => !/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(href);

/** A relative link in skills/<name>/SKILL.md, resolved to the file on GitHub. */
export function resolveSkillLink(name: string, href: string): string {
  if (!isRelative(href)) return href;
  const [path = "", fragment] = href.split("#", 2);
  const target = posix.normalize(posix.join("skills", name, path));
  if (target.startsWith("..")) return href;
  return `${REPOSITORY_URL}/blob/main/${target}${fragment ? `#${fragment}` : ""}`;
}

function highlight(code: string, lang: string | undefined): string {
  const language = lang && lang in bundledLanguages && highlighter.getLoadedLanguages().includes(lang) ? lang : "text";
  return highlighter.codeToHtml(code, { lang: language, theme: codeTheme });
}

/**
 * Renders a SKILL.md body for reading. These files are written for agents, so
 * angle-bracket placeholders such as `<spec-template>` are text, not markup:
 * raw HTML is escaped rather than passed through, which would make it vanish.
 */
export function renderSkillMarkdown(name: string, markdown: string): string {
  const marked = new Marked({
    gfm: true,
    walkTokens(token) {
      if (token.type === "link" || token.type === "image") {
        const link = token as Tokens.Link | Tokens.Image;
        link.href = resolveSkillLink(name, link.href);
      }
    },
    renderer: {
      html: ({ text }) => escapeHTML(text),
      code: ({ text, lang }) => highlight(text, lang?.split(/\s+/)[0]),
      link({ href, title, tokens }) {
        const label = this.parser.parseInline(tokens);
        const external = /^https?:/.test(href);
        return `<a href="${escapeHTML(href)}"${title ? ` title="${escapeHTML(title)}"` : ""}${external ? ' rel="noreferrer"' : ""}>${label}</a>`;
      },
    },
  });
  return marked.parse(markdown, { async: false });
}
