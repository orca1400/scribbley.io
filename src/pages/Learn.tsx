// src/pages/Learn.tsx
import React from "react";
import {
  BookOpen,
  Rocket,
  FileText,
  Wrench,
  HelpCircle,
  ChevronDown,
  Clipboard,
  ClipboardCheck,
  Brain,
  Users,
  Map,
  Compass,
  Timer,
  Pencil,
  Library,
  Target,
  Swords,
  Quote,
  Sparkles,
  Ruler,
  Landmark,
  NotebookPen,
  Heart,
  Eye,
  CheckCircle2,
  Info,
} from "lucide-react";

/* -----------------------------------------------------------
   Small UI helpers
----------------------------------------------------------- */

type CopyButtonProps = { text: string; label?: string; className?: string };
function CopyButton({ text, label = "Copy", className = "" }: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {}
      }}
      className={[
        "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium",
        "bg-white/80 hover:bg-white transition-colors",
        copied ? "border-green-300 text-green-700" : "border-gray-300 text-gray-700",
        className,
      ].join(" ")}
      aria-label={label}
      title={label}
    >
      {copied ? <ClipboardCheck className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
      {copied ? "Copied!" : label}
    </button>
  );
}

type CodeBlockProps = { code: string; language?: string; className?: string };
function CodeBlock({ code, language = "md", className = "" }: CodeBlockProps) {
  return (
    <div className={["relative group", className].join(" ")}>
      <div className="absolute right-2 top-2">
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm leading-relaxed">
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  );
}

type AccordionItemProps = {
  title: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  id?: string;
  className?: string;
};
function AccordionItem({ title, children, defaultOpen, id, className = "" }: AccordionItemProps) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  return (
    <section id={id} className={["rounded-2xl border border-gray-200 bg-white/80 backdrop-blur-sm", className].join(" ")}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 rounded-2xl p-5 text-left"
      >
        <div className="flex items-center gap-3">
          <ChevronDown
            className={[
              "h-5 w-5 shrink-0 transition-transform duration-200",
              open ? "rotate-180 text-purple-600" : "text-gray-400",
            ].join(" ")}
          />
          <h3 className="text-xl font-semibold text-gray-900">{title}</h3>
        </div>
      </button>
      <div
        className={[
          "grid transition-all duration-300 ease-in-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        ].join(" ")}
      >
        <div className="overflow-hidden">
          <div className="px-5 pb-6 pt-0 text-gray-800">{children}</div>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------
   Copyable templates & snippets
----------------------------------------------------------- */

const UNIVERSAL_BEATS = `Key beats (Fiction):
- Protagonist: <name, role, 1 defining trait>
- Goal: <one clear objective with a time box>
- Antagonist/Obstacle: <who/what blocks the goal>
- Stakes: <what is lost if they fail>
- Setting: <place + time + micro-detail>
- Tone/Mood: <two adjectives, comp title optional>
- Inciting Incident: <event that forces action>
- Midpoint/Reversal: <new info flips the plan>
- Climax: <decision under maximum pressure>
- Ending vibe: <emotional aftertaste>`;

const THEME_CARD = `Theme & controlling idea (Fiction):
- Theme statement: <X leads to Y when Z>
- Protagonist's Lie → Truth: <false belief> → <earned belief>
- Proof moments: <3 scenes that test the belief>
- Price of change: <what is sacrificed>
- Final image echoes theme: <show change on-page>`;

const NONFICTION_SKELETON = `Non-fiction project brief:
Audience: <who specifically?> (role, stage, pain)
Thesis: <one-sentence claim>
Transformation: <from→to>
Scope: <what's in / what's out>

Table of Contents (starter):
1. Problem & Promise (stakes)
2. Framework overview (2–4 pillars)
3. Pillar 1 → steps, examples, exercise
4. Pillar 2 → steps, examples, exercise
5. Pillar 3 → steps, examples, exercise
6. Pitfalls & misconceptions
7. Action plan & checklists
Appendix: references, glossary, further reading`;

const CLAIM_EVIDENCE_REASON = `Argument chain (CER):
- Claim: <what you assert>
- Evidence: <data, examples, citations>
- Reasoning: <why that evidence supports the claim (warrant)>
- Rebuttal: <address strongest counterpoint fairly>
- So what: <practical implication or next step>`;

const SCENE_FORMULA = `Scene recipe (Fiction):
1) Location & time anchor (1 line)
2) POV character with a Goal (what do they want now?)
3) Conflict/Obstacle (someone/something in the way)
4) Escalation (complication, reveal, time pressure)
5) Outcome (win/lose/partial) that changes the situation
6) Hook/Question that pulls to next scene`;

const SEQUEL_FORMULA = `Sequel (reaction beat) recipe:
A) Reaction (emotion, sensation)
B) Dilemma (weigh options; new info)
C) Decision (new goal → launches next scene)`;

const DIALOGUE_TIPS = `Dialogue quick rules:
- Purpose per line (move plot or reveal character)
- Trim greetings & filler; enter late, leave early
- Use action beats over adverbs: "She drummed fingers" > "she said excitedly"
- One idea per line; break for rhythm
- Tags: said/asked 90% of the time
- Subtext > on-the-nose; let what's unsaid carry weight`;

const THREE_ACT_12_BEATS = `3-Act (12-beat) Outline:
Act I
1. Hook (status quo + itch)
2. Inciting Incident (disruption)
3. First Door (point of no return)

Act II
4. Promise of the Premise (fun/games)
5. Pinch 1 (pressure spikes)
6. Midpoint (reversal or big reveal)
7. Pinch 2 (costs escalate)
8. Second Door (all is lost → new commitment)

Act III
9. Setup for Finale (plan)
10. Climax (choice under max pressure)
11. Resolution (fallout, consequences)
12. Final Image (changed world / echo of hook)`;

const SAVE_THE_CAT_LITE = `Save The Cat (lite):
- Opening Image
- Theme Stated
- Set-Up
- Catalyst
- Debate
- Break into 2
- B Story
- Fun and Games
- Midpoint
- Bad Guys Close In
- All Is Lost
- Dark Night of the Soul
- Break into 3
- Finale
- Final Image`;

const KISHOTENKETSU = `Kishōtenketsu (no direct conflict):
1) Ki – Setup / introduction
2) Shō – Development / expansion
3) Ten – Twist / surprising shift
4) Ketsu – Reconciliation / synthesis`;

const HERO_JOURNEY_SHORT = `Hero's Journey (short):
Ordinary World → Call → Refusal → Mentor → Threshold
→ Trials → Ordeal → Reward → Road Back → Resurrection → Return with Elixir`;

const SNOWFLAKE_STEPS = `Snowflake Method (summary):
1) 1-sentence premise
2) 1-paragraph synopsis (5 sentences)
3) Character sheets (goal, motivation, conflict)
4) 1-page plot summary
5) Expand characters (full arcs)
6) Expand to 4 pages
7) Scene list
8) Draft by scenes`;

const ROMANCE_BEATS = `Romance beats:
- Meet Cute (or meet disaster)
- Adhesion (forced proximity / shared project)
- Fun & Games (chemistry, banter, micro-wins)
- Midpoint: sense of "we"
- Breakup (lie/wound resurfaces, wrong lesson)
- Grand Gesture (truth confronted)
- HEA/HFN (earned emotional resolution)
Specify: trope, spice level, POV, time frame`;

const MYSTERY_COZY = `Cozy Mystery beats:
- Safe space disrupted by a curious clue
- Suspects (3) with plausible motives
- Red herrings & reveals (try/fail cycles)
- Midpoint: wrong suspicion collapses
- Climax: public reveal at a ritual/community event
- Aftermath: comfort restored, relationships deepen`;

const THRILLER_ENGINE = `Thriller engine:
- Ticking clock + visible villain plan
- Protagonist outmatched but relentless
- Complications raise public stakes
- Midpoint: moral cost becomes unavoidable
- Climax: trade-off between two losses
- Aftermath: price paid, system changed or not`;

const HORROR_TENSION = `Horror tension loop:
Normalcy → Omen → Dismissal → Disturbance → Rule learned
Repeat with higher stakes → Isolation → False safety → Violation of rule → Descent → Confrontation → Aftermath (lingering dread)`;

const FANTASY_RULES = `Fantasy world rules:
- Magic/tech source + cost
- Limits (what it cannot do)
- Who can wield + social consequences
- Economy/technology level
- Geography & travel constraints
- Cultural rituals & taboos
Use 1–2 rules per scene; show, don't lecture.`;

const POV_TENSE = `POV & Tense cheat sheet:
- 1st present: intimate, immediate, limited scope
- 1st past: reflective voice, flexible time
- 3rd limited past: classic novel feel, tight focus
- 3rd omniscient: wide lens, risk of distance
Rule: pick one primary; only switch with purpose.`;

const NONFICTION_CHAPTER = `Non-fiction chapter template:
1) Promise: what the reader will be able to do
2) Hook (story/data)
3) Framework step (explain simply)
4) Example/case (make it concrete)
5) Exercise/checklist
6) Common pitfalls
7) Summary & next step`;

const REVISION_PASSES = `Revision roadmap:
Pass 1 – Structure: beats, causality, goals, stakes
Pass 2 – Continuity: names, ages, world rules
Pass 3 – Scene craft: show vs tell, hooks, outcomes
Pass 4 – Line edit: clarity, verbs, cuts, voice
Pass 5 – Proof: typos, formatting, consistency`;

const CONFLICT_TYPES = `Conflict types:
- External (vs person, nature, system, tech)
- Internal (belief, fear, addiction, wound)
- Interpersonal (values clash inside relationships)
- Philosophical (theme-level: freedom vs order)
Good stories mix layers: external pressure exposes internal fault lines.`;

const PACING_MATH = `Pacing math (guideline):
- Hooks every ~800–1200 words (chapter edges)
- Scene goal stated in first 2–6 paragraphs
- Paragraphs average 50–120 words; vary length for rhythm
- Big twist ~45–55% mark (midpoint)
- Micro-cliff at end of most scenes`;

const BEFORE_AFTER = `Before (flat):
It was very cold outside and John felt bad about the meeting.

After (specific & active):
Wind needled through John's threadbare coat. He rehearsed the apology—third draft—while the bakery clock clicked toward 8:00. If Marta arrived before he did, she'd see the empty chair again. He started to run.`;

const ETHICS_SENSITIVITY = `Ethics checklist:
- Lived experience: consult or hire sensitivity readers for identities you don't share.
- Respect privacy: anonymize identifying details in memoir/case studies unless you have consent.
- Fairness: represent opposing views honestly in non-fiction.
- Harm-aware: avoid glamorizing violence or hate; contextualize responsibly.`;

const PUBLISHING_ROUTES = `Publishing routes:
Traditional: agent → publisher → editorial team → distribution.
Pros: upfront advance, professional team, bookstore reach.
Cons: slower, selective, less control.

Indie/Self: you act as publisher (hire editor/cover, upload to platforms).
Pros: speed, control, higher royalty per sale.
Cons: you handle quality, marketing, distribution.

Hybrid: pay-for-services with some traditional benefits—vet carefully.`;

const AI_COLLAB_PRACTICES = `AI collaboration best practices:
- Brief with beats & style constraints (copy from this page)
- Generate → curate → rewrite in your voice (never paste raw)
- Track canon: names, ages, rules, voice decisions
- Use regeneration intentionally: state what's *kept* and what's *changed*
- Always do human revision passes (structure → line) before publishing`;

/* -----------------------------------------------------------
   Estimator (words, reading time, writing plan)
----------------------------------------------------------- */

function EstimatorCard() {
  const [chapters, setChapters] = React.useState<number>(15);
  const [wordsPerChapter, setWordsPerChapter] = React.useState<number>(1800);
  const [wordsPerDay, setWordsPerDay] = React.useState<number>(1000);
  const [daysPerWeek, setDaysPerWeek] = React.useState<number>(5);

  const totalWords = Math.max(0, chapters) * Math.max(0, wordsPerChapter);
  const readingWPM = 250;
  const writingDaysNeeded = wordsPerDay > 0 ? Math.ceil(totalWords / wordsPerDay) : 0;
  const weeksNeeded = daysPerWeek > 0 ? Math.ceil(writingDaysNeeded / daysPerWeek) : 0;
  const hoursReading = totalWords > 0 ? (totalWords / (readingWPM * 60)).toFixed(1) : "0";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white/80 p-6">
      <div className="mb-4 flex items-center gap-2">
        <Ruler className="h-5 w-5 text-purple-600" />
        <h4 className="text-lg font-semibold text-gray-900">Estimator</h4>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <label className="text-sm">
          Chapters
          <input
            type="number"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            value={chapters}
            min={0}
            onChange={(e) => setChapters(parseInt(e.target.value || "0", 10))}
          />
        </label>
        <label className="text-sm">
          Words / chapter
          <input
            type="number"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            value={wordsPerChapter}
            min={0}
            onChange={(e) => setWordsPerChapter(parseInt(e.target.value || "0", 10))}
          />
        </label>
        <label className="text-sm">
          Words / day (writing)
          <input
            type="number"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            value={wordsPerDay}
            min={0}
            onChange={(e) => setWordsPerDay(parseInt(e.target.value || "0", 10))}
          />
        </label>
        <label className="text-sm">
          Days / week (writing)
          <input
            type="number"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            value={daysPerWeek}
            min={0}
            max={7}
            onChange={(e) => setDaysPerWeek(parseInt(e.target.value || "0", 10))}
          />
        </label>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="text-xs uppercase text-gray-500">Total words</div>
          <div className="text-xl font-semibold">{totalWords.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="text-xs uppercase text-gray-500">Est. reading time</div>
          <div className="text-xl font-semibold">{hoursReading} hr</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="text-xs uppercase text-gray-500">Writing schedule</div>
          <div className="text-xl font-semibold">
            {writingDaysNeeded} days ≈ {weeksNeeded} week{weeksNeeded === 1 ? "" : "s"}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -----------------------------------------------------------
   Page
----------------------------------------------------------- */

export default function Learn() {
  return (
    <div className="container mx-auto max-w-[1100px] px-4 pb-24">
      {/* Hero */}
      <div className="mb-10 mt-4 rounded-3xl border border-purple-200 bg-gradient-to-br from-purple-50 via-white to-indigo-50 p-10">
        <div className="flex flex-col items-center gap-4 text-center">
          <BookOpen className="h-12 w-12 text-purple-600" />
          <h1 className="text-5xl font-extrabold tracking-tight text-gray-900">Learn: The Practical Book-Writing Handbook</h1>
          <p className="max-w-4xl text-lg leading-relaxed text-gray-700">
            New to writing? Start here. This guide explains <strong>how stories and non-fiction work</strong>, why certain patterns keep readers turning pages,
            and gives you <strong>copy-and-use templates</strong> for outlines, scenes, beats, and revisions. Think of it as a cookbook: look up the thing you need, copy the recipe, and ship pages.
          </p>
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm">Beginner-friendly • Genre-agnostic • Results-focused</span>
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[300px,1fr]">
        {/* Sticky TOC */}
        <aside className="lg:sticky lg:top-6 h-max">
          <nav className="rounded-2xl border border-gray-200 bg-white/80 p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
              <Library className="h-4 w-4 text-purple-600" />
              Contents
            </div>
            <ol className="space-y-1 text-sm">
              {[
                ["#fundamentals", "Fundamentals"],
                ["#psychology", "Why structure works"],
                ["#story-model", "How stories work"],
                ["#theme", "Theme & controlling idea"],
                ["#conflict", "Conflict types"],
                ["#characters", "Characters & arcs"],
                ["#worldbuilding", "Worldbuilding & research"],
                ["#pov-tense", "POV & tense"],
                ["#outlines", "Outlines you can use"],
                ["#scene-templates", "Scene & sequel"],
                ["#genres", "Genre playbooks"],
                ["#nonfiction", "Non-fiction blueprints"],
                ["#pacing", "Pacing & chapter math"],
                ["#revision", "Revision roadmap"],
                ["#style", "Style & voice"],
                ["#dialogue", "Dialogue"],
                ["#ethics", "Ethics & sensitivity"],
                ["#publishing", "Publishing routes"],
                ["#ai", "AI collaboration"],
                ["#planner", "Estimators & planning"],
                ["#troubleshooting", "Troubleshooting"],
                ["#glossary", "Glossary"],
              ].map(([href, label]) => (
                <li key={href}>
                  <a
                    href={href}
                    className="block rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50 hover:text-purple-700"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        {/* Main content */}
        <main className="space-y-6">
          {/* Fundamentals */}
          <AccordionItem
            id="fundamentals"
            defaultOpen
            title={
              <span className="inline-flex items-center gap-2">
                <Brain className="h-5 w-5 text-purple-600" /> Fundamentals: the 5 things a good book does
              </span>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                  <Target className="h-4 w-4 text-indigo-600" /> Clear desire & stakes
                </h4>
                <p className="text-sm leading-relaxed">
                  Readers attach to a <em>desire line</em>: in fiction, the protagonist wants something concrete; in non-fiction,
                  the reader wants a specific capability or understanding. <strong>Stakes</strong> tell us why now and what it costs to fail.
                  If you ever feel lost, restate: “Who wants what, by when, and what breaks if they miss it?”
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                  <Swords className="h-4 w-4 text-rose-600" /> Causality & obstacles
                </h4>
                <p className="text-sm leading-relaxed">
                  Scenes should cause the next scenes. Obstacles are not just walls; they <em>force choices</em>.
                  Choices reveal character, alter strategy, and raise tension. If a scene can be removed without changing anything, it’s not causal—rewrite.
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                  <Sparkles className="h-4 w-4 text-yellow-600" /> Specificity & texture
                </h4>
                <p className="text-sm leading-relaxed">
                  Specific sensory details and concrete nouns create belief. “Rain” is generic; “rain jittering on a tin awning” is texture.
                  Pick one <em>micro-detail</em> per paragraph to ground readers without overloading them.
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                  <Heart className="h-4 w-4 text-emerald-600" /> Change & meaning
                </h4>
                <p className="text-sm leading-relaxed">
                  Stories are machines for change. In fiction, the character changes belief or behavior; in non-fiction, the reader gains ability.
                  Make the change <em>visible</em>: contrast the opening image with the final image, and state the lesson or capability gained.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-800">Universal Beats (copy into your prompt)</span>
                  <CopyButton text={UNIVERSAL_BEATS} label="Copy beats" />
                </div>
                <CodeBlock code={UNIVERSAL_BEATS} />
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-800">Before vs After (line-level)</span>
                  <CopyButton text={BEFORE_AFTER} label="Copy example" />
                </div>
                <CodeBlock code={BEFORE_AFTER} />
              </div>
            </div>
          </AccordionItem>

          {/* Psychology */}
          <AccordionItem
            id="psychology"
            title={
              <span className="inline-flex items-center gap-2">
                <Info className="h-5 w-5 text-indigo-600" /> Why structure works (reader psychology)
              </span>
            }
          >
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-sm leading-relaxed">
                Readers predict patterns unconsciously. A goal sets <em>expectation</em>; obstacles create <em>tension</em>; reversals reset
                <em> prediction error</em> (surprise), which spikes attention. That’s why midpoints and twists are effective: they update the model in the reader’s head.
                Structure is not a cage—it’s the path of expectations you promise and fulfill.
              </p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                <li><strong>Hook</strong>: a clear itch (question, oddity, pressure) creates a need to know.</li>
                <li><strong>Escalation</strong>: costs go up, options shrink → readers invest.</li>
                <li><strong>Climax</strong>: maximum pressure compresses the character into a revealing choice.</li>
                <li><strong>Resolution</strong>: gives meaning; shows what changed and what it cost.</li>
              </ul>
            </div>
          </AccordionItem>

          {/* How stories work */}
          <AccordionItem
            id="story-model"
            title={
              <span className="inline-flex items-center gap-2">
                <Map className="h-5 w-5 text-indigo-600" /> How stories work (scene → chapter → act)
              </span>
            }
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                  <Compass className="h-4 w-4 text-indigo-600" /> Scene formula
                </h4>
                <p className="text-sm mb-2 leading-relaxed">
                  A scene is a unit of change with a goal, conflict, escalation, outcome, and hook. If a scene lacks a goal or outcome, it’s probably exposition. Convert summary to action where possible.
                </p>
                <CodeBlock code={SCENE_FORMULA} />
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Sequel (reaction) keeps emotional logic</h4>
                <p className="text-sm mb-2 leading-relaxed">
                  After big events, show a <em>sequel</em>: reaction → dilemma → decision. This maintains believability and launches the next scene with momentum.
                </p>
                <CodeBlock code={SEQUEL_FORMULA} />
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
              <h4 className="mb-2 font-semibold text-gray-900">Chapters and acts</h4>
              <ul className="list-disc pl-5 text-sm space-y-1">
                <li>Chapters usually contain 1–3 scenes and end on a <em>mini-question</em>.</li>
                <li>Acts organize change: setup → escalation → resolution. Use the 12-beat list below as scaffolding.</li>
                <li>Pinch points “squeeze” your hero: raise stakes without resolving the problem.</li>
              </ul>
            </div>
          </AccordionItem>

          {/* Theme */}
          <AccordionItem
            id="theme"
            title={
              <span className="inline-flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-yellow-600" /> Theme & controlling idea
              </span>
            }
          >
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-sm leading-relaxed">
                Theme is the idea your story <em>argues</em>. It’s not a word (“love”) but a <strong>claim</strong> (“honest love requires vulnerability even when it risks loss”).
                Make it testable: give characters choices that cost them something; let actions—not speeches—prove the idea.
              </p>
              <div className="mt-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-800">Theme card (copy)</span>
                  <CopyButton text={THEME_CARD} label="Copy template" />
                </div>
                <CodeBlock code={THEME_CARD} />
              </div>
            </div>
          </AccordionItem>

          {/* Conflict */}
          <AccordionItem
            id="conflict"
            title={
              <span className="inline-flex items-center gap-2">
                <Swords className="h-5 w-5 text-rose-600" /> Conflict types (layer them)
              </span>
            }
          >
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-sm leading-relaxed">
                Conflict is not shouting; it’s <em>incompatible goals</em>. Combine external pressure with internal fault lines.
                When the outside squeeze exposes the inside flaw, readers feel inevitability—not randomness.
              </p>
              <CodeBlock code={CONFLICT_TYPES} />
            </div>
          </AccordionItem>

          {/* Characters */}
          <AccordionItem
            id="characters"
            title={
              <span className="inline-flex items-center gap-2">
                <Users className="h-5 w-5 text-pink-600" /> Characters & arcs (want, need, wound, lie)
              </span>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Character sheet (fiction)</h4>
                <CodeBlock
                  code={`Name: < >
Role: < >
Public Want: < >
Private Need: < >
Wound/Lie: < >   (false belief from past hurt)
Strength & Flaw: < > / < >
Relationship engine: <how they spark with others>
Movement: <how they change from Lie → Truth>`}
                />
                <p className="mt-2 text-sm leading-relaxed">
                  Common arcs: <strong>Positive</strong> (learn truth), <strong>Negative</strong> (embrace lie), <strong>Flat</strong> (hold truth that changes others).
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Reader transformation (non-fiction)</h4>
                <CodeBlock
                  code={`Reader: <role, stage>
Pain: <what hurts or blocks them>
Promise: <what they can do after this book>
Milestones: <3–5 capabilities they'll gain>
Constraints: <time, tools, ethics>`}
                />
                <p className="mt-2 text-sm leading-relaxed">
                  Teach by doing: example → step → exercise → pitfall. Repeat the loop until the capability sticks.
                </p>
              </div>
            </div>
          </AccordionItem>

          {/* Worldbuilding & research */}
          <AccordionItem
            id="worldbuilding"
            title={
              <span className="inline-flex items-center gap-2">
                <GlobeIcon /> Worldbuilding (fiction) & Research (non-fiction)
              </span>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Fiction world notes</h4>
                <CodeBlock code={FANTASY_RULES} />
                <p className="mt-2 text-sm leading-relaxed">
                  Pitfalls: lore dumps, rule drift, and convenient powers. Surface one vivid rule per scene and <em>enforce limits</em> during the climax for satisfying payoffs.
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Non-fiction research pack</h4>
                <CodeBlock code={CLAIM_EVIDENCE_REASON} />
                <p className="mt-2 text-sm leading-relaxed">
                  Readers trust you when you separate <strong>claim</strong>, <strong>evidence</strong>, and <strong>reasoning</strong>.
                  Cite fairly, include credible counterpoints, and note limitations. Transparency beats perfection.
                </p>
              </div>
            </div>
          </AccordionItem>

          {/* POV & Tense */}
          <AccordionItem
            id="pov-tense"
            title={
              <span className="inline-flex items-center gap-2">
                <Eye className="h-5 w-5 text-sky-600" /> POV & tense: pick your lens
              </span>
            }
          >
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <CodeBlock code={POV_TENSE} />
              <p className="mt-3 text-sm leading-relaxed">
                POV is a <em>promise</em> about information and intimacy. Choose one default; if you switch, signal clearly (chapter breaks, deliberate style shift) and keep continuity rules.
              </p>
            </div>
          </AccordionItem>

          {/* Outlines */}
          <AccordionItem
            id="outlines"
            title={
              <span className="inline-flex items-center gap-2">
                <NotebookPen className="h-5 w-5 text-fuchsia-600" /> Outlines you can use today
              </span>
            }
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <CodeBlock code={THREE_ACT_12_BEATS} />
              <CodeBlock code={SAVE_THE_CAT_LITE} />
              <CodeBlock code={KISHOTENKETSU} />
              <CodeBlock code={HERO_JOURNEY_SHORT} />
              <CodeBlock code={SNOWFLAKE_STEPS} />
            </div>
          </AccordionItem>

          {/* Scene templates */}
          <AccordionItem
            id="scene-templates"
            title={
              <span className="inline-flex items-center gap-2">
                <Wrench className="h-5 w-5 text-gray-700" /> Scene & sequel templates (plug-and-play)
              </span>
            }
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Action / Chase</h4>
                <CodeBlock
                  code={`Goal: escape/reach X before Y
Complication: new barrier appears
Raise stakes: collateral risk to ally/place
Beat shift: route blocked → risky shortcut
Outcome: succeed with cost OR fail → new plan
Exit hook: worse problem now visible`}
                />
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Investigation / Clue</h4>
                <CodeBlock
                  code={`Goal: verify hypothesis about suspect/object
Obstacle: gatekeeper, missing file, red herring
Beat shift: contradiction found
Reveal: small truth that flips next step
Outcome: partial win (new question unlocked)
Exit hook: ticking clock starts`}
                />
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Romance / Intimacy</h4>
                <CodeBlock
                  code={`Goal: connect without losing face
Obstacle: protective lie / old wound
Beat shift: spontaneous vulnerability
Micro-gesture: specific kindness or callback
Outcome: earned closeness w/ new risk
Exit hook: external pressure intrudes`}
                />
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Horror / Dread</h4>
                <CodeBlock code={HORROR_TENSION} />
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">Dialogue rules</span>
                <CopyButton text={DIALOGUE_TIPS} label="Copy rules" />
              </div>
              <CodeBlock code={DIALOGUE_TIPS} />
            </div>
          </AccordionItem>

          {/* Genres */}
          <AccordionItem
            id="genres"
            title={
              <span className="inline-flex items-center gap-2">
                <FileText className="h-5 w-5 text-indigo-600" /> Genre playbooks (beats & constraints)
              </span>
            }
          >
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Romance</h4>
                <p className="text-sm leading-relaxed">
                  Promise: emotional intimacy that earns a hopeful ending (HEA/HFN). Readers expect a central relationship,
                  meaningful obstacles (wound/lie), and consent-forward dynamics. Subgenres tweak surface (historical, paranormal, rom-com) but beats stay similar.
                </p>
                <CodeBlock code={ROMANCE_BEATS} />
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Mystery (Cozy)</h4>
                <p className="text-sm leading-relaxed">
                  Promise: fair-play puzzle in a warm community. Violence off-page, emphasis on wit and belonging. End by restoring order and relationships.
                </p>
                <CodeBlock code={MYSTERY_COZY} />
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Thriller</h4>
                <p className="text-sm leading-relaxed">
                  Promise: breathless escalation against a visible plan. Keep the clock loud, the antagonist competent, and the hero’s costs rising.
                </p>
                <CodeBlock code={THRILLER_ENGINE} />
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Horror</h4>
                <p className="text-sm leading-relaxed">
                  Promise: dread → violation of safety → aftermath. Establish rules (even for the supernatural) and break them at a moment that forces a terrible choice.
                </p>
                <CodeBlock code={HORROR_TENSION} />
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Fantasy / Sci-Fi</h4>
                <p className="text-sm leading-relaxed">
                  Promise: wonder + coherent consequences. New power/tech with a <em>price</em>; society responds.
                  Bind yourself to limits; creative use of constraints in the finale delights readers.
                </p>
                <CodeBlock
                  code={`Premise lever: new power or tech with a price
Mission spine: journey, heist, rebellion, survival
Rules: limits & costs (state 2; enforce them)
Midpoint: rule discovered that changes plan
Climax: power used within limits (creative choice)`}
                />
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Historical / Literary</h4>
                <p className="text-sm leading-relaxed">
                  Promise: deep human interiority against the grain of time and place.
                  Avoid anachronisms; anchor in work, objects, and rituals. Value resonance over twist.
                </p>
                <CodeBlock
                  code={`Anchor in time & social fabric
Micro-specific textures (objects, food, work)
Ethics of representation (avoid anachronism)
Internal conflict heavier than external
Ending: resonance over twist`}
                />
              </div>
            </div>
          </AccordionItem>

          {/* Non-fiction */}
          <AccordionItem
            id="nonfiction"
            title={
              <span className="inline-flex items-center gap-2">
                <FileText className="h-5 w-5 text-sky-600" /> Non-fiction blueprints
              </span>
            }
          >
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">Project skeleton</span>
                <CopyButton text={NONFICTION_SKELETON} label="Copy brief" />
              </div>
              <CodeBlock code={NONFICTION_SKELETON} />
              <p className="mt-3 text-sm leading-relaxed">
                Organize by <strong>problems → frameworks → steps → examples → exercises</strong>.
                Readers succeed when each chapter delivers a concrete capability and an action they can perform in minutes, not hours.
              </p>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">How-to (chapter)</h4>
                <CodeBlock code={NONFICTION_CHAPTER} />
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Memoir / Narrative NF</h4>
                <CodeBlock
                  code={`Lens: one promise (what this shows)
Time control: scene vs summary balance
Ethics: consent & privacy; fact-check events
Arc: external events reveal inner change
Chapter close: reflection → next question`}
                />
              </div>
            </div>
          </AccordionItem>

          {/* Pacing */}
          <AccordionItem
            id="pacing"
            title={
              <span className="inline-flex items-center gap-2">
                <Timer className="h-5 w-5 text-gray-700" /> Pacing & chapter math
              </span>
            }
          >
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-sm leading-relaxed">
                Pacing is rhythm. Vary sentence and paragraph length; alternate action and reflection; end scenes on questions. Use the “math” below as a loose guide, not a rulebook.
              </p>
              <CodeBlock code={PACING_MATH} />
            </div>
          </AccordionItem>

          {/* Revision */}
          <AccordionItem
            id="revision"
            title={
              <span className="inline-flex items-center gap-2">
                <Pencil className="h-5 w-5 text-emerald-600" /> Revision roadmap (passes, checklists & examples)
              </span>
            }
          >
            <div className="grid gap-4 md:grid-cols-3">
              {[
                ["Structure", `Causality between scenes\nBeats land where intended\nGoals & stakes visible\nProtagonist drives choices`],
                ["Continuity", `Names/ages consistent\nWorld/tech rules enforced\nTimeline & seasons match\nMotivations don't flip without cause`],
                ["Line edit", `Cut redundancy & filler\nReplace weak verbs\nRemove filter words (noticed, felt)\nBreak long sentences`],
              ].map(([title, list]) => (
                <div key={title} className="rounded-xl border border-gray-200 bg-white p-5">
                  <h4 className="mb-2 font-semibold text-gray-900">{title}</h4>
                  <CodeBlock code={list as string} />
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Common traps</h4>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  <li><strong>Floating heads</strong> (dialogue with no place): add an anchoring beat every 3–5 lines.</li>
                  <li><strong>As-you-know</strong> exposition: hide information inside conflict or a discovery.</li>
                  <li><strong>Coincidence saves</strong>: if luck rescues your hero, make it a cost next scene or remove it.</li>
                </ul>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Prompt for a surgical rewrite</h4>
                <CodeBlock
                  code={`Rewrite the following scene to (a) state a visible goal in the first 6 paragraphs,
(b) escalate with a concrete complication, and (c) end with a hook question.
Preserve character voice and world rules. Cut filler and filter words.
Return only the revised scene.`}
                />
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">All passes (copy)</span>
                <CopyButton text={REVISION_PASSES} label="Copy roadmap" />
              </div>
              <CodeBlock code={REVISION_PASSES} />
            </div>
          </AccordionItem>

          {/* Style & voice */}
          <AccordionItem
            id="style"
            title={
              <span className="inline-flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-yellow-600" /> Style & voice (micro-skills)
              </span>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Make it vivid</h4>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  <li>Prefer concrete nouns & active verbs.</li>
                  <li>Swap abstract adjectives for specific images.</li>
                  <li>Use “beats” (tiny actions) to ground dialogue.</li>
                </ul>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Cut the fog</h4>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  <li>Delete filler: just, very, actually, really.</li>
                  <li>Remove filter verbs: <em>he noticed, she felt</em>.</li>
                  <li>Break long sentences; vary rhythm.</li>
                </ul>
              </div>
            </div>
          </AccordionItem>

          {/* Dialogue */}
          <AccordionItem
            id="dialogue"
            title={
              <span className="inline-flex items-center gap-2">
                <Quote className="h-5 w-5 text-rose-600" /> Dialogue that works
              </span>
            }
          >
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">Quick rules</span>
                <CopyButton text={DIALOGUE_TIPS} label="Copy rules" />
              </div>
              <CodeBlock code={DIALOGUE_TIPS} />
              <p className="mt-2 text-sm leading-relaxed">
                Pro tip: give characters <em>conflicting goals</em> inside a scene.
                Dialogue sings when people want different things politely.
              </p>
            </div>
          </AccordionItem>

          {/* Ethics */}
          <AccordionItem
            id="ethics"
            title={
              <span className="inline-flex items-center gap-2">
                <ShieldIcon /> Ethics & sensitivity
              </span>
            }
          >
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <p className="text-sm leading-relaxed">
                Writing is power. Handle it with care. When you depict identities you don’t share, prioritize accuracy and dignity.
                In non-fiction, seek consent and source responsibly. Transparency about limits earns trust.
              </p>
              <CodeBlock code={ETHICS_SENSITIVITY} />
            </div>
          </AccordionItem>

          {/* Publishing routes */}
          <AccordionItem
            id="publishing"
            title={
              <span className="inline-flex items-center gap-2">
                <FileText className="h-5 w-5 text-violet-600" /> Publishing routes (choose a path)
              </span>
            }
          >
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <CodeBlock code={PUBLISHING_ROUTES} />
              <p className="mt-2 text-sm leading-relaxed">
                Whatever route you choose, quality control is non-negotiable: professional edit, strong cover, clear metadata, and an honest description.
              </p>
            </div>
          </AccordionItem>

          {/* AI collaboration */}
          <AccordionItem
            id="ai"
            title={
              <span className="inline-flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-600" /> AI collaboration (work smarter)
              </span>
            }
          >
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <CodeBlock code={AI_COLLAB_PRACTICES} />
              <p className="mt-2 text-sm leading-relaxed">
                Treat AI like a sharp assistant: great for lists of options, outlines, tight rewrites, and idea exploration—never a substitute for your judgement or voice.
              </p>
            </div>
          </AccordionItem>

          {/* Estimators & planning */}
          <AccordionItem
            id="planner"
            title={
              <span className="inline-flex items-center gap-2">
                <Timer className="h-5 w-5 text-gray-700" /> Estimators & planning
              </span>
            }
          >
            <EstimatorCard />
          </AccordionItem>

          {/* Troubleshooting */}
          <AccordionItem
            id="troubleshooting"
            title={
              <span className="inline-flex items-center gap-2">
                <HelpCircle className="h-5 w-5 text-rose-600" /> Troubleshooting (fast fixes)
              </span>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Feels generic</h4>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  <li>Add 3 specifics: profession, micro-setting, time window.</li>
                  <li>State tone with 2 adjectives + 1 comp title.</li>
                  <li>Swap summary for an action beat or sensory detail.</li>
                </ul>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Loses continuity</h4>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  <li>Add a “Continuity” beat: canonical names/ages/rules.</li>
                  <li>Remind constraints before regenerations.</li>
                </ul>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Pacing drags</h4>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  <li>Start scenes late; end early. Cut throat-clearing.</li>
                  <li>End paragraphs with hooks; shorten long blocks.</li>
                </ul>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h4 className="mb-2 font-semibold text-gray-900">Cover mismatch</h4>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  <li>Keep one art direction; remove conflicting style words.</li>
                  <li>Add beat like “Cover palette: muted teal & cream”.</li>
                </ul>
              </div>
            </div>
          </AccordionItem>

          {/* Glossary */}
          <AccordionItem
            id="glossary"
            title={
              <span className="inline-flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-purple-600" /> Glossary (quick refs)
              </span>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <dl className="text-sm">
                  <dt className="font-semibold text-gray-900">Beat</dt>
                  <dd className="mb-2 text-gray-700">A small story unit: a choice, reveal, or reversal.</dd>
                  <dt className="font-semibold text-gray-900">Hook</dt>
                  <dd className="mb-2 text-gray-700">An unresolved question that pulls readers forward.</dd>
                  <dt className="font-semibold text-gray-900">Pinch Point</dt>
                  <dd className="mb-2 text-gray-700">A moment that squeezes the hero and raises stakes.</dd>
                  <dt className="font-semibold text-gray-900">POV</dt>
                  <dd className="mb-2 text-gray-700">Point of View — the lens of perception.</dd>
                </dl>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <dl className="text-sm">
                  <dt className="font-semibold text-gray-900">Try/Fail Cycle</dt>
                  <dd className="mb-2 text-gray-700">Attempts to solve problems that escalate costs.</dd>
                  <dt className="font-semibold text-gray-900">Theme</dt>
                  <dd className="mb-2 text-gray-700">The idea your story argues through outcomes.</dd>
                  <dt className="font-semibold text-gray-900">Filter Words</dt>
                  <dd className="mb-2 text-gray-700">Words that distance the reader (noticed, felt, saw).</dd>
                </dl>
              </div>
            </div>
          </AccordionItem>
        </main>
      </div>
    </div>
  );
}

/* tiny inline icons to keep imports tidy */
function GlobeIcon() {
  return (
    <svg className="h-5 w-5 text-teal-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <circle cx="12" cy="12" r="10" strokeWidth="2"></circle>
      <path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20" strokeWidth="2"></path>
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg className="h-5 w-5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M12 3l7 4v5c0 5-3.2 9-7 9s-7-4-7-9V7l7-4z" strokeWidth="2"></path>
      <path d="M9 12l2 2 4-4" strokeWidth="2"></path>
    </svg>
  );
}
