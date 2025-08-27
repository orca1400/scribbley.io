// src/pages/Templates.tsx
import React from 'react';
import { Search, SlidersHorizontal, Eye, ArrowRight, Tag, X } from 'lucide-react';
import type { Template } from '../data/templates';
import { TEMPLATES } from '../data/templates';

type TemplatesProps = {
  onUseTemplate: (payload: {
    genreGroup: 'fiction' | 'non-fiction';
    subgenre: string;
    prompt: string;
    title: string;
  }) => void;
};

export default function Templates({ onUseTemplate }: TemplatesProps) {
  const [q, setQ] = React.useState('');
  const [group, setGroup] = React.useState<'all' | 'fiction' | 'non-fiction'>('all');
  const [kind, setKind] = React.useState<'all' | 'framework' | 'beats' | 'outline'>('all');
  const [difficulty, setDifficulty] = React.useState<'all' | 'beginner' | 'intermediate' | 'advanced'>('all');
  const [active, setActive] = React.useState<Template | null>(null);

  const filtered = React.useMemo(() => {
    const ql = q.trim().toLowerCase();
    return TEMPLATES.filter(t => {
      if (group !== 'all' && t.genreGroup !== group) return false;
      if (kind !== 'all' && t.kind !== kind) return false;
      if (difficulty !== 'all' && t.difficulty !== difficulty) return false;
      if (!ql) return true;
      const hay = `${t.title} ${t.subgenre} ${t.blurb} ${t.badges.join(' ')} ${t.outline.join(' ')}`.toLowerCase();
      return hay.includes(ql);
    }).sort((a, b) => Number(b.hero) - Number(a.hero));
  }, [q, group, kind, difficulty]);

  return (
    <div className="max-w-7xl mx-auto">
      {/* Hero */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Book Writing Templates</h1>
        <p className="text-gray-600 mt-2 max-w-2xl mx-auto">
          Pick a proven structure and jump straight into writing. Filter by fiction/non-fiction, beats, or frameworks—then start with one click.
        </p>
      </div>

      {/* Toolbar */}
      <div className="bg-white/70 border rounded-xl p-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex-1 flex items-center gap-2">
          <Search className="w-5 h-5 text-gray-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search templates, e.g. ‘romance’, ‘how-to’, ‘beats’…"
            className="w-full bg-transparent outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ChipSelect
            label="Type"
            value={group}
            onChange={(v) => setGroup(v as any)}
            options={[
              { label: 'All', value: 'all' },
              { label: 'Fiction', value: 'fiction' },
              { label: 'Non-Fiction', value: 'non-fiction' },
            ]}
          />
          <ChipSelect
            label="Format"
            value={kind}
            onChange={(v) => setKind(v as any)}
            options={[
              { label: 'All', value: 'all' },
              { label: 'Framework', value: 'framework' },
              { label: 'Beats', value: 'beats' },
              { label: 'Outline', value: 'outline' },
            ]}
          />
          <ChipSelect
            label="Level"
            value={difficulty}
            onChange={(v) => setDifficulty(v as any)}
            options={[
              { label: 'All', value: 'all' },
              { label: 'Beginner', value: 'beginner' },
              { label: 'Intermediate', value: 'intermediate' },
              { label: 'Advanced', value: 'advanced' },
            ]}
          />
        </div>
      </div>

      {/* Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
        {filtered.map((t) => (
          <article
            key={t.id}
            className={`group bg-white/70 border rounded-2xl p-5 hover:shadow-md transition ${t.hero ? 'border-purple-400' : ''}`}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold text-gray-900">{t.title}</h3>
              <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">{prettyKind(t.kind)}</span>
            </div>

            <p className="text-sm text-gray-600 mt-2">{t.blurb}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Badge>{capitalize(t.genreGroup)}</Badge>
              <Badge>{t.subgenre}</Badge>
              <Badge>{capitalize(t.difficulty)}</Badge>
              {t.badges.slice(0, 2).map(b => <Badge key={b}>{b}</Badge>)}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => setActive(t)}
                className="inline-flex items-center gap-2 text-gray-700 hover:text-gray-900"
              >
                <Eye className="w-4 h-4" /> Preview
              </button>
              <button
                onClick={() => onUseTemplate({ genreGroup: t.genreGroup, subgenre: t.subgenre, prompt: t.starterPrompt, title: t.title })}
                className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-500 to-blue-500 text-white px-3 py-2 rounded-lg font-medium hover:shadow-md"
              >
                Use template <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </article>
        ))}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center text-gray-600 py-12">
          No templates match your filters.
        </div>
      )}

      {/* Preview modal */}
      {active && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h4 className="font-semibold text-gray-900">{active.title}</h4>
                <p className="text-xs text-gray-500">
                  {capitalize(active.genreGroup)} • {active.subgenre} • {prettyKind(active.kind)} • {capitalize(active.difficulty)}
                </p>
              </div>
              <button onClick={() => setActive(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            <div className="px-5 py-4">
              <p className="text-sm text-gray-700">{active.blurb}</p>

              <div className="mt-4">
                <h5 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4" /> Key beats / sections
                </h5>
                <ol className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm text-gray-700 list-decimal list-inside">
                  {active.outline.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ol>
              </div>

              <div className="mt-4">
                <h5 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <Tag className="w-4 h-4" /> Starter prompt
                </h5>
                <pre className="mt-2 text-sm bg-gray-50 border rounded-lg p-3 whitespace-pre-wrap">{active.starterPrompt}</pre>
              </div>
            </div>

            <div className="flex items-center justify-between px-5 py-4 border-t bg-gray-50">
              <button onClick={() => setActive(null)} className="text-gray-700 hover:text-gray-900">
                Close
              </button>
              <button
                onClick={() => {
                  onUseTemplate({
                    genreGroup: 'fiction',          // 'fiction' | 'non-fiction'
                    subgenre: 'Horror',
                    prompt: 'Gothic seaside horror with psychological tension.',
                    beats: [
                      { label: 'Protagonist', value: 'Mara, a marine biologist with insomnia' },
                      { label: 'Inciting Incident', value: 'A body washes ashore with strange barnacles' },
                      { label: 'Midpoint', value: 'She discovers the town’s pact with the sea' },
                      { label: 'Climax', value: 'Storm night confrontation at the lighthouse' },
                    ],
                  });
                }}
                className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-500 to-blue-500 text-white px-4 py-2 rounded-lg font-medium hover:shadow-md"
              >
                Use this template <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- tiny UI helpers ---------- */
function ChipSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="bg-gray-100 rounded-full p-1">
        <div className="flex">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={`text-xs px-3 py-1 rounded-full transition ${
                value === opt.value ? 'bg-white border shadow-sm' : 'text-gray-600 hover:bg-white/70'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">{children}</span>;
}
function prettyKind(k: string) {
  return k === 'beats' ? 'Beats' : k === 'outline' ? 'Outline' : 'Framework';
}
function capitalize<T extends string>(s: T): T {
  return (s.charAt(0).toUpperCase() + s.slice(1)) as T;
}
