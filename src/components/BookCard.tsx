import React from 'react';
import { Image as ImageIcon, BookOpen } from 'lucide-react';
import { UserBook } from '../types/database';

type BookCardProps = {
  book: Pick<UserBook, 'id' | 'title' | 'cover_url' | 'updated_at' | 'word_count' | 'total_chapters'>;
  onOpen?: (bookId: string) => void;         // optional callback
  href?: string;                              // or pass a link if you use a router <Link> wrapper
};

export const BookCard: React.FC<BookCardProps> = ({ book, onOpen, href }) => {
  const [broken, setBroken] = React.useState(false);
  const click = () => onOpen?.(book.id);

  const Cover = (
    <div className="relative w-full aspect-[2/3] overflow-hidden rounded-xl border bg-white">
      {book.cover_url && !broken ? (
        <img
          src={book.cover_url}
          alt={`${book.title} cover`}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="h-full w-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
          <ImageIcon className="w-8 h-8 text-slate-400" />
        </div>
      )}
      <div className="absolute inset-0 pointer-events-none ring-1 ring-black/5 rounded-xl" />
    </div>
  );

  const meta = (
    <div className="mt-3">
      <h3 className="text-sm font-semibold text-gray-900 line-clamp-2">{book.title}</h3>
      <div className="mt-1 flex items-center gap-3 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1">
          <BookOpen className="w-3.5 h-3.5" />
          {book.total_chapters ?? 0} ch
        </span>
        <span>{(book.word_count ?? 0).toLocaleString()} words</span>
      </div>
      {book.updated_at && (
        <div className="mt-1 text-[11px] text-gray-500">
          Updated {new Date(book.updated_at).toLocaleDateString()}
        </div>
      )}
    </div>
  );

  // If href is provided, caller can wrap this with <Link>—otherwise we use a button.
  if (href) {
    return (
      <a href={href} className="group block rounded-2xl p-3 border bg-white hover:shadow-md transition">
        {Cover}
        {meta}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={click}
      className="group text-left w-full rounded-2xl p-3 border bg-white hover:shadow-md transition"
    >
      {Cover}
      {meta}
    </button>
  );
};

export default BookCard;
