import React from 'react';
import { Lock, BookOpen } from 'lucide-react';

import { Book } from '../utils/bookParser';

interface ChapterListProps {
  book: Book;
  isAuthenticated: boolean;
  onAuthRequired: () => void;
}

export function ChapterList({ book, isAuthenticated, onAuthRequired }: ChapterListProps) {
  const [selectedChapter, setSelectedChapter] = React.useState(0);

  return (
    <div className="space-y-8">
      {/* Book Title */}
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-800 mb-2">{book.title}</h1>
        <div className="w-24 h-1 bg-gradient-to-r from-purple-500 to-blue-500 mx-auto rounded-full"></div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8 h-full">
      {/* Chapter Navigation */}
      <div className="lg:col-span-1">
        <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl p-6 sticky top-8">
          <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
            <BookOpen className="w-6 h-6 mr-2 text-purple-600" />
            Chapters
          </h3>
          <div className="space-y-2">
            {book.chapters.map((chapter, index) => (
              <button
                key={index}
                onClick={() => setSelectedChapter(index)}
                className={`w-full text-left p-3 rounded-lg transition-all duration-200 relative ${
                  selectedChapter === index
                    ? 'bg-purple-500 text-white shadow-md'
                    : 'bg-purple-50 hover:bg-purple-100 text-purple-800'
                }`}
              >
                <div className="font-medium text-sm">
                  Chapter {index + 1}
                  {!isAuthenticated && index > 0 && (
                    <Lock className="w-3 h-3 inline ml-2 opacity-60" />
                  )}
                </div>
                <div className="text-xs opacity-90 truncate">
                  {chapter.title}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chapter Content */}
      <div className="lg:col-span-2">
        <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">
            Chapter {selectedChapter + 1}: {book.chapters[selectedChapter]?.title}
          </h2>
          
          <div className="prose prose-lg max-w-none">
            <div className="text-gray-800 leading-relaxed space-y-4">
              {!isAuthenticated && selectedChapter > 0 ? (
                // Show locked message for non-authenticated users (chapters 2+)
                <>
                  <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-2 border-dashed border-purple-300 rounded-xl p-12 text-center">
                      <Lock className="w-12 h-12 text-purple-500 mx-auto mb-4" />
                      <h3 className="text-xl font-bold text-gray-800 mb-2">
                        Chapter Locked
                      </h3>
                      <p className="text-gray-600 mb-4">
                        Create a free account to unlock all chapters and continue reading this book.
                      </p>
                      <button
                        onClick={onAuthRequired}
                        className="bg-gradient-to-r from-purple-500 to-blue-500 text-white px-8 py-4 rounded-lg font-semibold hover:shadow-lg transition-all duration-300 text-lg"
                      >
                        Unlock All Chapters
                      </button>
                  </div>
                </>
              ) : (
                // Show full content for authenticated users OR first chapter for non-authenticated
                book.chapters[selectedChapter]?.content ? (
                  book.chapters[selectedChapter].content
                    .split(/\n\s*\n/)
                    .filter(paragraph => paragraph.trim())
                    .map((paragraph, index) => (
                      <p key={index} className="mb-4">
                        {paragraph.trim()}
                      </p>
                    ))
                ) : (
                  <p className="text-gray-500 italic">No content available for this chapter.</p>
                )
              )}
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}