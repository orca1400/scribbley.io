export default function Changelog() {
  const items = [
    { date: "2025-08-01", title: "Cover streaming", desc: "Live preview while generating covers." },
    { date: "2025-07-18", title: "Rewrite modal", desc: "Select text and rewrite with AI." },
  ];
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Changelog</h1>
      <ul className="space-y-4">
        {items.map(i => (
          <li key={i.date} className="bg-white border rounded-xl p-4">
            <div className="text-xs text-gray-500">{i.date}</div>
            <div className="font-semibold text-gray-900">{i.title}</div>
            <div className="text-gray-700 text-sm">{i.desc}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
