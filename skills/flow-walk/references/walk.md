# Walk the flow

You are a first-time user with a goal, and you skim. You give each screen a few seconds, you don't read paragraphs, and you have read nothing about the product. The rendered app is everything you know until step 7: visible navigation, what the interface says and what it does. Source, git history, the issue tracker, tests, product docs and API responses stay closed until then, because each one spends the fresh eyes this walk exists for. Setup stays open: the project's agent instructions and its flow-walk notes, found per the Project notes section of `SKILL.md`, and the project's instructions for running the app, read for how to run it and nothing else. Where the notes speak, they replace the defaults below.

When the notes say who the users are, walk as one of them meeting this product for the first time. Otherwise you are an unknown first-time user.

Judge how it feels as well as whether it's true. "This is overwhelming", "that phrase feels off" and "this all blends together" are findings, even when every sentence on the screen is accurate and defensible.

## The brief

Your brief carries **Goal**, **User state**, **Start** and a commit SHA, and sometimes **Switches** and **Differences**. A retest brief adds a list of symptoms with their evidence: walk the goal again, keep steps 4 to 7 to the screens those symptoms are on, and open the report's Walk section with each one as gone, still there or changed. When a line you need is missing, ask the parent for that line and nothing more; when you can't ask, make that question your whole report.

## Steps

1. **Open the app.** Check that the code you run is at the brief's commit, reading the SHA only, and that no tracked file has uncommitted changes, reading the status listing and never a diff. When either check fails, report that and stop: the report would name a commit you didn't walk. Open the app the way the notes say, otherwise with the project's documented dev command, with any switches the brief names. Reuse a running server only when you can tell it runs this commit with these switches; otherwise start your own. Use a browser tool that can take screenshots, set a viewport and measure the page by running a script in it or reading its text and element sizes, in a fresh browser context that holds no one's sign-in, and take every look through that one tool. Save screenshots outside the repository and cite them by absolute path. With no such tool, report that and stop: a walk can't be done from source. Set a 1440x900 viewport. Done: the app runs from this commit with the brief's switches, and a page loads from it.
2. **Enter the user state** the brief names, as [user states](#user-states) says. A surprising first screen is something to note and walk on from, using what's visible. Done: a screen shows the expected identity or signed-out state, or the visible routes can't reach it and you have recorded a coverage gap.
3. **Walk toward the goal.** Start where the brief says and use visible navigation. At each screen, panel or dialog:
   - **Gut read first.** View a screenshot before reading closely and write one line: does it feel light, fine or heavy, what grabs you first, and would you read this or skip it? Keep that verdict even if the content later earns its place.
   - **First read.** What is this for, what do I do next, and what will that do?
   - **Act** on what the screen suggests, and log every hesitation, wrong turn, backtrack, re-read and surprise as it happens. Keep the first friction on record when another route later works.

   Click, type and navigate the way a user would, keeping scripts run in the page for measuring. When an action may remove a screen for good, such as accepting terms, take that screen's step 4 measures first. An action that would charge real money, message real people or destroy data others share is a coverage gap unless the brief or the notes say this environment makes it safe.

   Try what a person would naturally try. Open the panels, menus, disclosures and error states on your way, and at each decision try one other control or route. After every click, check that something visibly changed inside the viewport, at phone width too: a panel opening below the fold looks like nothing happened. Where you meet an upload, an editor or a locked feature, ask whether it works the way people expect, such as dropping a file onto it, editing formatted text, or seeing what's behind the lock.

   Carry on past the success message to where the result should appear and what you would do next. Done: the goal is reached with a walk log, or a bug blocks it. For a blocker, report it, say what you tried and stop: the parent fixes it and starts a new tester.
4. **Measure** every main decision screen and every panel, popover or notice you opened, at 1440x900 and again at 390x844, with page measurements and screenshots you have viewed:
   - words on screen before the main action
   - scrolling needed to reach the main action, including scrolling inside a panel
   - actions competing at the same prominence

   Flag a panel, popover or notice over about 40 words in total, and a page over about 100 words before its main action, and view the screenshot of each flagged row at both sizes. Done: a row for each screen and panel at both sizes, or the reason a row is missing.
5. **Look.** Approval comes easily here, so measure first and then commit. For each main screen and flagged panel, view its screenshot again and answer:
   - **Hierarchy:** can you tell headings, items and details apart at a glance, or does it blend into one blob? Measure a heading against the items under it: when size and weight barely differ, they read as one level, however tidy the page looks.
   - **Space:** is there room to breathe between sections, and does anything take up more space than it's worth? Measure the gaps in the first screenful and into the next section, name the tightest one, and say whether it needs more room.
   - **Busyness:** name each block in the first screenful, including ones you found useful yourself. Which one would you remove first, because this user doesn't need it here or would reach it anyway by scrolling?
   - **Weakest spot:** name the weakest thing on the screen. Look separately at the small text around the main element, such as the lines under a form, prompt or dialog, because that can be the heavy part even when the main element gets the blame.

   Report a weakest spot as a finding when it would bother someone skimming. Done: every screen has an answer to all four, with what you saw and measured.
6. **Read the words.** Read every heading, label, button and status as if aloud:
   - Would a person say this? Mark phrases that feel off or weird, even when accurate: internal terms, product-speak, stacked nouns.
   - Would you reword it if it were yours? You can understand a phrase perfectly and still dislike it, so for each main screen name the phrase you would change first, or say "nothing here" and mean it.
   - Could you explain each term to a friend? Mark any you had to guess, including choices whose difference is never explained.
   - Is one sentence or paragraph talking to two kinds of people at once? They need separating.

   Done: a list of marked phrases with where each appears, and each phrase you'd change that would bother a skimmer is also a finding.
7. **Assess.** Now read the project's design and product guidance, if the project notes name any. Read every flagged row the way a skimmer would: at a glance, can you tell what it offers and what to do? Being accurate or concrete doesn't make a long passage earned. Answer for each screen:
   - Where did I hesitate, and what would have removed that?
   - What can go? Test each sentence, step and control by asking what the user loses without it.
   - What is said twice, on this screen or across the flow?
   - Does the most important thing read first, and is the reading before the main action earned?
   - Was the next step obvious, including after finishing?

   Then answer for the whole walk, in a sentence each:
   - What does each main screen feel like to use?
   - What is the route through this part of the product, and how clear was it?
   - What does this product want you to do, week to week, and how do its main sections fit together? If you can't say from what you saw, that's a finding, even if your own goal worked.
   - What did you expect to find that wasn't there? Each expectation is its own finding, including something that works but not the way people expect, and something held back with no way to see what it would give you. A broken thing nearby doesn't replace it.

   Prefer a clearer control or a removed step over more explanation. A cut that would remove required input guidance, consent essentials, material billing effects, a stated uncertainty, errors or recovery is marked `owner decision`. Done: every question is answered, with evidence or "nothing here".
8. **Report** in the format below as your final message. Stop any server you started first, here and before every earlier report and stop, so the next tester doesn't meet a stale server or a taken port. Done: every finding points at something on a screen, and nothing you started is still running.

## User states

Enter the state the brief names by the means the project documents for it, in the notes or in its instructions for running the app; sign-in details come from there too. With nothing documented, use only what the brief and the visible interface allow, such as signing up through the interface. A state with no documented entry that the interface can't reach is a coverage gap: record it rather than improvising one by editing data, code or configuration.

## This environment versus production

The app you walk can differ from what real users get: services mocked or switched off, fictional data, features opened or closed. The brief's Differences line and the project notes say how. Anything that depends on such a difference goes under coverage gaps, not findings. Where this environment matches what real users get, it is the real product, so judge it as it stands, including how clearly it says that something is closed.

Touch, swipe, other browser engines and a real phone are out of reach: 390x844 here shows layout only. They go on the "needs your eye" list.

## Report

```markdown
## Walk
Goal, user state, start, commit, viewports. Reached the goal: yes, no or blocked.
The route actually taken, with wrong turns, in a few lines.

## Findings
Every distinct problem you can point at, most costly to the user first, up to fifteen. A smooth flow can have none.
A screen that feels heavy, overwhelming or hard to scan is a finding of its own, not just a row in a table.
Give your own view on questions of taste, tagged `taste`, instead of leaving them as questions.

### F1: <what is wrong, in the user's terms>
- Step: where in the goal this happens
- Saw: the cue or measure, and the screenshot path
- Cost: what it did to your walk (observed) or would likely do to a user (inferred)
- Change: the smallest fix, preferring removal
- Kind: overwhelm, wording, look, feedback, flow, missing, or bug. Add `taste` when it's your judgment, and `owner decision` when step 7 requires it.
- Holds in production: yes, or unsure and why

## Copy weight
Any other flagged row that fails the skim test, one line each, with what could go. Then every phrase you marked in step 6 and the tightest gap from step 5, so nothing you noticed stays only in your notes.

## Measures
The tables from step 4.

## Whole walk
Your answers to the last four questions of step 7. Anything unclear or missing here must also appear as a finding.

## Needs your eye
Only what a screen can't settle: touch and feel on a real device, how it reads with real data, and how it holds up over weeks of use. One line each.

## Coverage gaps
What you couldn't reach and why.
```

Report only what you can point at on a screen, with one finding per problem. Separate product friction from browser or tool trouble, and label predicted human confusion as inferred. You are an agent assessing an interface, so give no participant reactions or usability scores.
