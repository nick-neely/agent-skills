---
name: leaving-pr-comments
description: Use when drafting or posting GitHub issue or PR comments, including inline reviews, replies in the user's voice, and explanations before resolving feedback.
---

# Leaving PR Comments

1. **Confirm intent and target.** Post only when the user's request or active workflow authorizes it. Verify the issue or PR, thread, diff side and current line as applicable. Return drafts or review findings in chat unless posting is authorized.
2. **Write the response.** Lead with the conclusion. Cite the code, behavior, check, reproduction or fix commit that supports it. Distinguish observed facts from judgment and deferral from implementation. Keep the response concise and useful to the reviewer.
   - **Default.** Write in first person in the user's voice, with no agent byline or added signature. Attribute personal experiences, opinions, or commitments to the user only when they supplied or approved them.
   - **Attributed comments.** Use an agent byline when the user requests one or when the workflow or project rules specify one, such as for an automated PR review. Use the specified format and a verified agent or workflow name. If the user explicitly asks to omit required attribution, keep the comment as a draft and ask how to proceed.
3. **Preview.** Check the full Markdown, quotes and attachments for secrets or private context. Preserve literal content with a structured tool argument or body file. Verify quoting and blank lines.
4. **Post and verify.** Submit once. Read back the saved comment or review and retain its URL. If a request times out, check whether it succeeded before retrying. Resolve a review thread only after the explanation was saved successfully and its finding is accounted for. Leave unresolved disputes or blocking findings open.
