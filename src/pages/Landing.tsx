// src/pages/Landing.tsx
import React from 'react';
import {
  Sparkles,
  ArrowRight,
  BookOpen,
  PenTool,
  Library,
  LayoutDashboard,
  Image as ImageIcon,
  FileText,
  Download,
  ShieldCheck,
  HelpCircle,
} from 'lucide-react';

type LandingProps = {
  onStart: () => void;
  onPricing: () => void;
};

export default function Landing({ onStart, onPricing }: LandingProps) {
  return (
    <div className="container mx-auto px-4 pb-20">
      {/* Hero */}
      <section className="pt-8 pb-10 text-center">
        <div className="flex items-center justify-center mb-4">
          <BookOpen className="w-12 h-12 text-purple-600 mr-3" />
          <h1 className="text-4xl font-bold text-gray-800">Write books the easy way</h1>
          <Sparkles className="w-8 h-8 text-yellow-500 ml-3" />
        </div>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Turn ideas into finished drafts with AI-assisted planning, chapter generation, and a clean editor.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            onClick={onStart}
            className="bg-gradient-to-r from-purple-500 to-blue-500 text-white px-6 py-3 rounded-full font-semibold hover:shadow-lg transition-all duration-200 flex items-center"
          >
            Start writing <ArrowRight className="w-5 h-5 ml-2" />
          </button>
          <button
            onClick={onPricing}
            className="bg-white/80 backdrop-blur-sm text-purple-700 px-6 py-3 rounded-full font-semibold border hover:bg-white transition-all duration-200"
          >
            See pricing
          </button>
        </div>

        {/* Social proof */}
        <div className="mt-10">
          <div className="flex items-center justify-center gap-4">
            {/* placeholders — swap src later */}
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-12 w-12 rounded-full bg-gray-300 border shadow-sm overflow-hidden"
                aria-label="User avatar placeholder"
              />
            ))}
          </div>
          <p className="mt-4 text-sm font-medium text-gray-700">
            Many writers already use <span className="text-purple-700">Scribbley.io</span>.
          </p>
        </div>
      </section>

      {/* What type of story are you writing? */}
      <section className="mt-14">
        <h2 className="text-2xl font-bold text-gray-900 text-center">What type of story are you writing?</h2>
        <p className="text-gray-600 text-center max-w-3xl mx-auto mt-2">
          First pick <span className="font-medium">Fiction</span> or <span className="font-medium">Non-Fiction</span>.
          Then choose a <span className="font-medium">subgenre</span> to give the AI tone and structure. You can also type your own.
        </p>

        <div className="grid md:grid-cols-2 gap-6 mt-8">
          {/* Fiction card */}
          <div className="bg-white/70 rounded-2xl shadow-sm border p-6">
            <div className="flex items-center gap-3 mb-3">
              <PenTool className="w-6 h-6 text-purple-600" />
              <h3 className="text-xl font-semibold text-gray-900">Fiction</h3>
            </div>
            <p className="text-gray-600">
              Narrative driven. You control characters, plot, pacing, and world-building.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 mt-4 text-sm">
              <div className="bg-purple-50 rounded-lg p-3">
                <p className="font-medium text-purple-900">Popular subgenres</p>
                <ul className="mt-2 text-purple-900/80 list-disc list-inside space-y-1">
                  <li>Romance, Mystery, Thriller</li>
                  <li>Fantasy, Sci-Fi, Horror</li>
                </ul>
              </div>
              <div className="bg-purple-50 rounded-lg p-3">
                <p className="font-medium text-purple-900">Tips</p>
                <ul className="mt-2 text-purple-900/80 list-disc list-inside space-y-1">
                  <li>Describe main character & goal</li>
                  <li>Set the tone (light, dark, epic)</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Non-Fiction card */}
          <div className="bg-white/70 rounded-2xl shadow-sm border p-6">
            <div className="flex items-center gap-3 mb-3">
              <Library className="w-6 h-6 text-blue-600" />
              <h3 className="text-xl font-semibold text-gray-900">Non-Fiction</h3>
            </div>
            <p className="text-gray-600">
              Topic driven. You set the expertise level, structure, and key takeaways.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 mt-4 text-sm">
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="font-medium text-blue-900">Popular subgenres</p>
                <ul className="mt-2 text-blue-900/80 list-disc list-inside space-y-1">
                  <li>Self-Help, Business, History</li>
                  <li>Biography, Science, Education</li>
                </ul>
              </div>
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="font-medium text-blue-900">Tips</p>
                <ul className="mt-2 text-blue-900/80 list-disc list-inside space-y-1">
                  <li>Define your reader (beginner/pro)</li>
                  <li>List 5–7 core chapters</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Genre vs Subgenre helper */}
        <div className="mt-6 text-sm text-gray-600 bg-white/60 border rounded-xl p-4">
          <p>
            <span className="font-semibold text-gray-800">Genre</span> = broad category (e.g. Fiction).
            <span className="font-semibold text-gray-800 ml-2">Subgenre</span> = flavor (e.g. Cozy Mystery, Space Opera).
            Subgenres help the AI match tone, tropes, and structure.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="mt-16">
        <h2 className="text-2xl font-bold text-gray-900 text-center">How Scribbley works</h2>
        <p className="text-gray-600 text-center max-w-2xl mx-auto mt-2">
          Two smooth flows: try it without an account, or sign in for the full dashboard experience.
        </p>

        <div className="grid lg:grid-cols-2 gap-8 mt-8">
          {/* Non-authenticated flow */}
          <div className="bg-white/70 rounded-2xl shadow-sm border p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Without an account</h3>
            <ol className="space-y-4">
              <li className="flex gap-3">
                <div className="h-7 w-7 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs mt-1">1</div>
                <div>
                  <p className="font-medium text-gray-800">Pick category & subgenre</p>
                  <p className="text-gray-600 text-sm">Tell us Fiction/Non-Fiction and the vibe you want.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <div className="h-7 w-7 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs mt-1">2</div>
                <div>
                  <p className="font-medium text-gray-800">Describe your idea</p>
                  <p className="text-gray-600 text-sm">Give characters, setting, themes, or table-of-contents ideas.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <div className="h-7 w-7 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs mt-1">3</div>
                <div>
                  <p className="font-medium text-gray-800">Generate & preview</p>
                  <p className="text-gray-600 text-sm">We produce a full sample with a cover preview.</p>
                </div>
              </li>
            </ol>

            <div className="flex flex-wrap gap-3 mt-5 text-sm">
              <span className="inline-flex items-center gap-2 bg-gray-100 border rounded-full px-3 py-2">
                <ImageIcon className="w-4 h-4" /> Cover preview
              </span>
              <span className="inline-flex items-center gap-2 bg-gray-100 border rounded-full px-3 py-2">
                <FileText className="w-4 h-4" /> Chapter list
              </span>
            </div>
          </div>

          {/* Dashboard flow */}
          <div className="bg-white/70 rounded-2xl shadow-sm border p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">With the dashboard</h3>
            <ol className="space-y-4">
              <li className="flex gap-3">
                <div className="h-7 w-7 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs mt-1">1</div>
                <div>
                  <p className="font-medium text-gray-800">Create a project</p>
                  <p className="text-gray-600 text-sm">Start from your idea; we generate Chapter 1 instantly.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <div className="h-7 w-7 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs mt-1">2</div>
                <div>
                  <p className="font-medium text-gray-800">Keep generating</p>
                  <p className="text-gray-600 text-sm">Use summaries to guide the next chapters and keep continuity.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <div className="h-7 w-7 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs mt-1">3</div>
                <div>
                  <p className="font-medium text-gray-800">Edit, reroll cover, export</p>
                  <p className="text-gray-600 text-sm">Polish your text, regenerate the cover, and export to PDF.</p>
                </div>
              </li>
            </ol>

            <div className="flex flex-wrap gap-3 mt-5 text-sm">
              <span className="inline-flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-full px-3 py-2">
                <LayoutDashboard className="w-4 h-4" /> Project dashboard
              </span>
              <span className="inline-flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-full px-3 py-2">
                <Download className="w-4 h-4" /> PDF export
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mt-16">
        <h2 className="text-2xl font-bold text-gray-900 text-center">FAQ</h2>
        <p className="text-gray-600 text-center max-w-2xl mx-auto mt-2">
          Quick answers to common questions about Scribbley.io.
        </p>

        <div className="max-w-3xl mx-auto mt-8 space-y-3">
          <FAQItem q="Do I own the content I generate?">
            Yes. You own the outputs you create with Scribbley.io. You’re free to edit, publish, and sell them.
          </FAQItem>

          <FAQItem q="What’s included in Free vs Pro vs Premium?">
            Free lets you try shorter chapters and a limited number of projects per month. Pro increases word limits, chapters,
            and unlocks longer chapter options. Premium gives you our highest limits and extra-long chapters.
          </FAQItem>

          <FAQItem q="How are word limits counted?">
            We count AI-generated words in your projects each month. You can see usage in your dashboard at any time.
          </FAQItem>

          <FAQItem q="Can I rewrite or expand chapters later?">
            Absolutely. You can regenerate sections, add new chapters, or refine tone and POV at any time.
          </FAQItem>

          <FAQItem q="Will you use my data to train models?">
            We don’t use your project content to train Scribbley. For anonymous generations we show a GDPR consent box.
          </FAQItem>

          <FAQItem q="Which languages are supported?">
            English works best, but many languages generate well. Try your native language and see the quality.
          </FAQItem>

          <FAQItem q="Can I export my book?">
            Yes, you can export to PDF from the dashboard. More formats are planned.
          </FAQItem>

          <FAQItem q="How do covers work?">
            We generate a cover preview automatically; logged-in users can also reroll covers from the editor.
          </FAQItem>
        </div>

        <div className="text-center mt-10">
          <button
            onClick={onStart}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-500 to-blue-500 text-white px-6 py-3 rounded-full font-semibold hover:shadow-lg transition-all duration-200"
          >
            Start writing now <ArrowRight className="w-5 h-5" />
          </button>
          <p className="text-xs text-gray-500 mt-3 flex items-center justify-center gap-2">
            <ShieldCheck className="w-4 h-4" /> Your drafts are private to your account.
          </p>
        </div>
      </section>
    </div>
  );
}

/* ---------------- Small FAQ component ---------------- */
function FAQItem({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group bg-white/70 border rounded-xl p-4 open:shadow-sm">
      <summary className="list-none flex items-start justify-between cursor-pointer">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-purple-600 mt-0.5" />
          <span className="font-medium text-gray-900">{q}</span>
        </div>
        <span className="ml-4 text-gray-500 group-open:rotate-180 transition-transform">▾</span>
      </summary>
      <div className="mt-3 text-gray-700 leading-relaxed">{children}</div>
    </details>
  );
}
