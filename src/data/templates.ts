// src/data/templates.ts
export type TemplateKind = 'framework' | 'beats' | 'outline';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export type Template = {
  id: string;
  title: string;
  kind: TemplateKind;
  genreGroup: 'fiction' | 'non-fiction';
  subgenre: string;             // the “vibe” we’ll preselect
  blurb: string;
  badges: string[];             // quick tags for the card
  difficulty: Difficulty;
  hero?: boolean;               // highlight in grid (top row)
  outline: string[];            // key beats/sections users can skim
  starterPrompt: string;        // what we pass into your description box
};

export const TEMPLATES: Template[] = [
  {
    id: 'heros-journey',
    title: "Hero's Journey",
    kind: 'framework',
    genreGroup: 'fiction',
    subgenre: 'Fantasy',
    blurb: 'Classic 12-stage arc for transformational adventures.',
    badges: ['Character Arc', 'Quest', 'Mythic'],
    difficulty: 'beginner',
    hero: true,
    outline: [
      'Ordinary World', 'Call to Adventure', 'Refusal', 'Mentor',
      'Crossing the Threshold', 'Tests, Allies, Enemies',
      'Approach to the Inmost Cave', 'Ordeal', 'Reward',
      'The Road Back', 'Resurrection', 'Return with the Elixir'
    ],
    starterPrompt:
      "Write a Fantasy novel using the Hero’s Journey. Protagonist: a reluctant farmhand with secret lineage. Tone: epic, hopeful. Setting: mountain frontier. Include the 12 stages and clear stakes."
  },
  {
    id: 'save-the-cat',
    title: 'Save the Cat® Beats',
    kind: 'beats',
    genreGroup: 'fiction',
    subgenre: 'Thriller',
    blurb: 'Fifteen famous beats to keep momentum and payoff tight.',
    badges: ['Pacing', 'Commercial'],
    difficulty: 'intermediate',
    outline: [
      'Opening Image', 'Theme Stated', 'Set-Up', 'Catalyst', 'Debate',
      'Break into Two', 'B Story', 'Fun & Games', 'Midpoint',
      'Bad Guys Close In', 'All Is Lost', 'Dark Night of the Soul',
      'Break into Three', 'Finale', 'Final Image'
    ],
    starterPrompt:
      "Outline a high-stakes Thriller using the Save the Cat® 15-beat structure. Protagonist: investigative journalist. Antagonist: biotech conglomerate. Setting: rainy coastal city. Tone: tense, propulsive."
  },
  {
    id: 'three-act',
    title: 'Three-Act Structure',
    kind: 'framework',
    genreGroup: 'fiction',
    subgenre: 'Romance',
    blurb: 'Simple, reliable story engine with Act I–III.',
    badges: ['Classic', 'Versatile'],
    difficulty: 'beginner',
    outline: [
      'Act I: Hook • Inciting Incident • Lock-In',
      'Act II: First Pinch • Midpoint • Second Pinch',
      'Act III: Crisis • Climax • Resolution'
    ],
    starterPrompt:
      "Create a contemporary Romance using the Three-Act Structure. Trope: rivals-to-lovers. Setting: indie bookstore vs. big-box chain. Tone: witty, warm. Include meet-cute, midpoint reversal, satisfying HEA."
  },
  {
    id: 'snowflake',
    title: 'Snowflake Method',
    kind: 'outline',
    genreGroup: 'fiction',
    subgenre: 'Science Fiction',
    blurb: 'Iterative expansion from one sentence to full scenes.',
    badges: ['Planning', 'Scalable'],
    difficulty: 'advanced',
    outline: [
      '1-sentence summary', '1-paragraph plot',
      'Character summaries', 'Expand to page', 'Scene list'
    ],
    starterPrompt:
      "Plan a Science Fiction novel with the Snowflake Method. Premise: first contact via dreams. Protagonist: sleep researcher. Themes: communication, trust. Produce steps from 1-sentence to scene list."
  },
  {
    id: 'seven-point',
    title: 'Seven-Point Story',
    kind: 'framework',
    genreGroup: 'fiction',
    subgenre: 'Horror',
    blurb: 'Start with the ending; map seven anchors for tension.',
    badges: ['Tension', 'Reverse-Engineering'],
    difficulty: 'intermediate',
    outline: [
      'Hook', 'First Plot Point', 'First Pinch',
      'Midpoint', 'Second Pinch', 'Second Plot Point', 'Resolution'
    ],
    starterPrompt:
      "Outline a psychological Horror using the Seven-Point method. Ending: protagonist embraces the house. Setting: decaying seaside manor. Tone: uncanny, creeping dread."
  },
  {
    id: 'romancing-the-beat',
    title: 'Romancing the Beat',
    kind: 'beats',
    genreGroup: 'fiction',
    subgenre: 'Romance',
    blurb: 'A romance-specific beat sheet for emotional payoff.',
    badges: ['Romance', 'Emotional Arc'],
    difficulty: 'beginner',
    outline: [
      'Set-up (They + Need)', 'Meet', 'No Way', 'Adhesion',
      'Deepen', 'Pinch', 'Crisis', 'Dark Night', 'Joyful Defeat', 'HEA/HFN'
    ],
    starterPrompt:
      "Plot a RomCom with ‘Romancing the Beat’. Leads: grumpy museum curator & chaotic event planner. Setting: city arts fundraiser. Tone: sparkling banter, heart."
  },
  {
    id: 'how-to-guide',
    title: 'How-To / Step-By-Step Guide',
    kind: 'outline',
    genreGroup: 'non-fiction',
    subgenre: 'Education',
    blurb: 'Teach a skill with outcomes, steps, and checklists.',
    badges: ['Actionable', 'Clear'],
    difficulty: 'beginner',
    outline: [
      'Audience & prerequisites', 'Learning outcomes', 'Tools',
      'Step-by-step', 'Common mistakes', 'Checklist', 'Resources'
    ],
    starterPrompt:
      "Write a non-fiction How-To guide teaching beginners how to start a balcony vegetable garden. Include tools, step-by-step, pitfalls, and an end-of-chapter checklist."
  },
  {
    id: 'problem-solution',
    title: 'Business Problem → Solution',
    kind: 'framework',
    genreGroup: 'non-fiction',
    subgenre: 'Business',
    blurb: 'Diagnose pains, propose playbooks, prove with cases.',
    badges: ['B2B', 'Case Studies'],
    difficulty: 'intermediate',
    outline: [
      'Problem space', 'Root causes', 'Framework', 'Playbook',
      'Case studies', 'Objections', 'Metrics/next steps'
    ],
    starterPrompt:
      "Draft a business book chapter on reducing churn in SaaS. Audience: product leaders. Include a diagnostic, a simple framework, and 2 compact case studies."
  },
  {
    id: 'memoir-arc',
    title: 'Memoir Narrative Arc',
    kind: 'framework',
    genreGroup: 'non-fiction',
    subgenre: 'Memoir',
    blurb: 'A lived experience shaped with scene and reflection.',
    badges: ['Voice', 'Reflective'],
    difficulty: 'advanced',
    outline: [
      'Defining moment', 'Before/after worldview',
      'Key scenes', 'Reflection & takeaway', 'Return with insight'
    ],
    starterPrompt:
      "Outline a Memoir arc about rebuilding after a startup failure. Voice: candid, unsentimental. Focus on 5 pivotal scenes and reflective takeaways."
  },
];
