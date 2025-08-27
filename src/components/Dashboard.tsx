// src/components/Dashboard.tsx
import React, { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  Book,
  Plus,
  User as UserIcon,
  Settings,
  LogOut,
  X,
  Check,
  Trash2,
  Image as ImageIcon,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useUserProfile } from '../hooks/useUserProfile';
import { useEntitlements } from '../hooks/useEntitlements';
import { SettingsPanel } from './SettingsPanel';
import { BackupPanel } from './BackupPanel';
import { BackupStatus } from './BackupStatus';
import { notifyUsage } from '../utils/notifyUsage';
import type { UserBook } from '../types/database';
import { startCheckout, openBillingPortal } from '../lib/billing';

type PlanTier = 'free' | 'pro' | 'premium';

interface DashboardProps {
  user: User;
  onCreateBook: () => void;
  onOpenBook: (book: UserBook) => void;
}

const BookGridCard: React.FC<{
  book: UserBook;
  onOpen: (book: UserBook) => void;
  onDelete: (book: UserBook) => void;
}> = ({ book, onOpen, onDelete }) => {
  const [broken, setBroken] = useState(false);

  const total = book.total_chapters ?? 0;
  const read = book.chapters_read ?? 0;
  const progressPct = total > 0 ? Math.min(100, (read / total) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl shadow-sm border hover:shadow-md transition">
      <button
        type="button"
        onClick={() => onOpen(book)}
        className="block w-full text-left"
        aria-label={`Open ${book.title}`}
      >
        {/* Cover */}
        <div className="relative w-full aspect-[2/3] overflow-hidden rounded-t-2xl bg-slate-100">
          {book.cover_url && !broken ? (
            <img
              src={book.cover_url}
              alt={`${book.title} cover`}
              className="h-full w-full object-cover"
              loading="lazy"
              onError={() => setBroken(true)}
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-slate-100 to-slate-200 grid place-content-center">
              <ImageIcon className="w-8 h-8 text-slate-400" />
            </div>
          )}
          <div className="absolute inset-0 pointer-events-none ring-1 ring-black/5 rounded-t-2xl" />
        </div>

        {/* Meta */}
        <div className="p-4">
          {/* Title */}
          <h3 className="text-base font-semibold text-gray-900 line-clamp-2">{book.title}</h3>

          {/* Chapters (full text) */}
          <div className="mt-2 text-sm text-gray-700">
            {read}/{total} chapters
          </div>

          {/* Genre • Subgenre */}
          {(book.genre || book.subgenre) && (
            <div className="mt-1 text-sm text-gray-700 truncate">
              <span className="capitalize">{book.genre}</span>
              {book.subgenre ? (
                <>
                  {' '}
                  • <span className="capitalize">{book.subgenre}</span>
                </>
              ) : null}
            </div>
          )}

          {/* Words */}
          <div className="mt-1 text-sm text-gray-500">
            {(book.word_count ?? 0).toLocaleString()} words
          </div>

          {/* Progress bar */}
          <div className="mt-3 w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-green-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {book.updated_at && (
            <p className="text-[11px] text-gray-500 mt-2">
              Last updated: {new Date(book.updated_at).toLocaleDateString()}
            </p>
          )}
        </div>
      </button>

      {/* Actions */}
      <div className="px-4 pb-4 -mt-2 flex justify-end">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(book);
          }}
          className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
          title={`Delete ${book.title}`}
          aria-label={`Delete ${book.title}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export function Dashboard({ user, onCreateBook, onOpenBook }: DashboardProps) {
  // 1) Hooks
  const { profile, books, loading, updateProfile, realTimeUsage, refreshData } = useUserProfile(user.id);
  const { entitlements } = useEntitlements(user.id);

  const [showPlanModal, setShowPlanModal] = useState(false);
  const [hasShownAutoModal, setHasShownAutoModal] = useState(false);
  const [isYearly, setIsYearly] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [bookToDelete, setBookToDelete] = useState<UserBook | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBackup, setShowBackup] = useState(false);

  // 2) Derived usage + plan
  const isAuthed = !!user?.id && user.id !== '00000000-0000-0000-0000-000000000000';
  const effectiveTier = (entitlements?.tier ?? profile?.plan_tier ?? 'free') as PlanTier;

  const monthlyUsed = realTimeUsage?.billableWords ?? profile?.words_used_this_month ?? 0;
  const monthlyLimit = profile?.monthly_word_limit ?? 0;
  const usagePercentage = monthlyLimit > 0 ? (monthlyUsed / monthlyLimit) * 100 : 0;
  const monthlyPctRounded = Math.floor(usagePercentage);

  const hasExceededWordLimit = useMemo(() => {
    if (!profile) return false;
    if (!isAuthed) return false;
    const wordLimit = monthlyLimit || Number.POSITIVE_INFINITY;
    return monthlyUsed >= wordLimit;
  }, [profile, isAuthed, monthlyUsed, monthlyLimit]);

  const hasActiveSubscription =
    (profile?.plan_tier === 'pro' || profile?.plan_tier === 'premium') ||
    (profile as any)?.subscription_status === 'active';

  const canCreateContent = useMemo(() => {
    if (!isAuthed) return false;
    if (!profile) return false;
    if (effectiveTier === 'premium' || effectiveTier === 'pro') return true;
    return !hasExceededWordLimit;
  }, [isAuthed, profile, effectiveTier, hasExceededWordLimit]);

  // Respect projects (books) limit if present on profile
  const canCreateBook = useMemo(() => {
    const projectsLimit = profile?.projects_limit ?? Number.POSITIVE_INFINITY;
    return canCreateContent && books.length < projectsLimit;
  }, [canCreateContent, books.length, profile?.projects_limit]);

  // 3) Auto-open plan modal for free users (once)
  useEffect(() => {
    if (!loading && profile && !hasShownAutoModal && effectiveTier === 'free') {
      const timer = setTimeout(() => {
        setShowPlanModal(true);
        setHasShownAutoModal(true);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [loading, profile, hasShownAutoModal, effectiveTier]);

  // 4) Email alerts at 80% / 100% (client-side guard)
  useEffect(() => {
    if (!profile || !user?.email || monthlyLimit <= 0) return;

    const monthKey = new Date().toISOString().slice(0, 7);
    const baseKey = `usageAlerts:${user.id}:${monthKey}`;
    const sent80Key = `${baseKey}:80`;
    const sent100Key = `${baseKey}:100`;

    const alreadySent80 = localStorage.getItem(sent80Key) === '1';
    const alreadySent100 = localStorage.getItem(sent100Key) === '1';

    if (monthlyPctRounded >= 100 && !alreadySent100) {
      notifyUsage({
        email: user.email!,
        usagePct: 100,
        wordsUsed: monthlyUsed,
        limit: monthlyLimit,
        userName: (profile as any)?.display_name ?? undefined,
        plan: effectiveTier,
      });
      localStorage.setItem(sent100Key, '1');
      return;
    }

    if (monthlyPctRounded >= 80 && monthlyPctRounded < 100 && !alreadySent80) {
      notifyUsage({
        email: user.email!,
        usagePct: 80,
        wordsUsed: monthlyUsed,
        limit: monthlyLimit,
        userName: (profile as any)?.display_name ?? undefined,
        plan: effectiveTier,
      });
      localStorage.setItem(sent80Key, '1');
    }
  }, [monthlyPctRounded, monthlyUsed, monthlyLimit, profile, user?.email, user?.id, effectiveTier]);

  // 5) Helpers
  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const handleCreateBookClick = () => {
    if (!canCreateBook) {
      setShowPlanModal(true);
      return;
    }
    onCreateBook();
  };

  // Real checkout/portal flow (no local profile mutations)
  const handlePlanUpgrade = async (newPlan: PlanTier) => {
    try {
      if (newPlan === 'free') {
        // Manage / cancel via billing portal
        await openBillingPortal();
        setShowPlanModal(false);
        return;
      }
      // Redirect to Stripe checkout
      await startCheckout({
        plan: newPlan as 'pro' | 'premium',
        interval: isYearly ? 'year' : 'month',
      });
      // Redirect back is handled by Stripe + your webhooks
    } catch (error) {
      console.error('Checkout/Billing error:', error);
      alert('Konnte den Bezahlvorgang nicht starten. Bitte versuch es erneut.');
    }
  };

  const handleDeleteBook = (book: UserBook) => {
    setBookToDelete(book);
    setShowDeleteModal(true);
  };

  const confirmDeleteBook = async () => {
    if (!bookToDelete) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('user_books')
        .delete()
        .eq('id', bookToDelete.id)
        .eq('user_id', user.id);
      if (error) throw error;

      await refreshData?.();
    } catch (error) {
      console.error('Error deleting book:', error);
      alert('Failed to delete book. Please try again.');
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
      setBookToDelete(null);
    }
  };

  const getPlanColor = (plan: string) => {
    switch (plan) {
      case 'pro':
        return 'bg-blue-100 text-blue-800';
      case 'premium':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getPlanName = (plan: string) => {
    switch (plan) {
      case 'pro':
        return 'Pro';
      case 'premium':
        return 'Premium';
      default:
        return 'Free';
    }
  };

  // 6) Loading
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  // 7) UI
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Book className="h-8 w-8 text-indigo-600" />
              <h1 className="ml-2 text-xl font-bold text-gray-900">AI Book Generator</h1>
            </div>

            <div className="flex items-center space-x-4">
              <button
                onClick={() => setShowPlanModal(true)}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-all hover:shadow-md ${getPlanColor(
                  effectiveTier
                )}`}
              >
                {getPlanName(effectiveTier)} Plan
              </button>

              <div className="flex items-center space-x-2 text-sm text-gray-600">
                <UserIcon className="h-4 w-4" />
                <span>{user.email}</span>
              </div>

              <button
                onClick={handleCreateBookClick}
                disabled={!canCreateBook}
                className="flex items-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                <span>{!canCreateBook ? 'Upgrade to Create Books' : 'New Book'}</span>
              </button>

              <button
                onClick={() => setShowSettings(true)}
                className="flex items-center space-x-2 bg-white text-gray-700 px-3 py-2 rounded-lg border hover:bg-gray-50 transition-colors"
                title="Settings"
              >
                <Settings className="h-4 w-4" />
                <span>Settings</span>
              </button>

              {hasActiveSubscription && (
                <button
                  onClick={openBillingPortal}
                  className="flex items-center space-x-2 bg-white text-gray-700 px-3 py-2 rounded-lg border hover:bg-gray-50 transition-colors"
                  title="Manage billing"
                >
                  <span>Manage Billing</span>
                </button>
              )}

              <button
                onClick={handleSignOut}
                className="flex items-center space-x-2 bg-white text-gray-700 px-3 py-2 rounded-lg border hover:bg-gray-50 transition-colors"
                title="Sign out"
              >
                <LogOut className="h-4 h-4" />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Consent nudge */}
        {profile && !profile.ai_processing_consent && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
            <div className="text-blue-900 text-sm">
              <strong>AI Processing Consent is off.</strong> Enable it in Settings to generate chapters and use rewrite.
            </div>
          </div>
        )}

        {/* Usage Stats */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Monthly Usage</h2>

          {/* Backup Status */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between">
              <BackupStatus userId={user.id} className="flex-1" />
              <button
                onClick={() => setShowBackup(true)}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Manage Backups
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>Words Used</span>
                <span>
                  {monthlyUsed.toLocaleString()} / {monthlyLimit.toLocaleString()}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${
                    hasExceededWordLimit ? 'bg-red-500' : 'bg-indigo-600'
                  }`}
                  style={{ width: `${Math.min(usagePercentage, 100)}%` }}
                />
              </div>

              {realTimeUsage?.freeWords && realTimeUsage.freeWords > 0 && (
                <div className="mt-2 text-sm text-green-600">
                  Free usage this month: {realTimeUsage.freeWords.toLocaleString()} words
                </div>
              )}

              {/* 80% banner */}
              {monthlyLimit > 0 && monthlyPctRounded >= 80 && monthlyPctRounded < 100 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-3">
                  <div className="text-amber-800 text-sm">
                    <strong>Achtung:</strong> Du hast {monthlyPctRounded}% deines Monatskontingents verbraucht (
                    {monthlyUsed.toLocaleString()} / {monthlyLimit.toLocaleString()} Wörter).
                  </div>
                </div>
              )}

              {/* 100% banner */}
              {monthlyLimit > 0 && monthlyPctRounded >= 100 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-3">
                  <div className="text-red-800 text-sm">
                    <strong>Limit erreicht:</strong> {monthlyUsed.toLocaleString()} / {monthlyLimit.toLocaleString()}{' '}
                    Wörter. Bitte upgrade deinen Plan, um weiterzuschreiben.
                  </div>
                </div>
              )}

              {/* legacy exceeded banner */}
              {hasExceededWordLimit && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-3">
                  <div className="flex items-center">
                    <svg
                      className="w-5 h-5 text-red-500 mr-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                      />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-red-800">Monthly limit exceeded</p>
                      <p className="text-xs text-red-600">Upgrade your plan to continue creating books</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Books */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Your Books</h2>
          <button
            onClick={handleCreateBookClick}
            disabled={!canCreateBook}
            className="flex items-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            <span>{!canCreateBook ? 'Upgrade to Create Books' : 'New Book'}</span>
          </button>
        </div>

        {/* Grid with cover cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6">
          {books.map((book) => (
            <BookGridCard
              key={book.id}
              book={book}
              onOpen={onOpenBook}
              onDelete={handleDeleteBook}
            />
          ))}

          {books.length === 0 && (
            <div className="col-span-full text-center py-12">
              <Book className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No books yet</h3>
              <p className="text-gray-600 mb-4">Create your first AI-generated book to get started</p>
              <button
                onClick={handleCreateBookClick}
                disabled={!canCreateBook}
                className="inline-flex items-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                <span>{!canCreateBook ? 'Upgrade to Create Books' : 'Create Your First Book'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && profile && (
        <SettingsPanel user={user} profile={profile} onClose={() => setShowSettings(false)} onSave={updateProfile} />
      )}

      {/* Backup Panel */}
      {showBackup && <BackupPanel userId={user.id} onClose={() => setShowBackup(false)} />}

      {/* Plan Selection Modal */}
      {showPlanModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="p-6 border-b">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-900">Choose Your Plan</h2>
                <button onClick={() => setShowPlanModal(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-6 w-6" />
                </button>
              </div>

              {/* Monthly / Yearly toggle */}
              <div className="flex items-center justify-center mt-6">
                <span className={`text-sm font-medium mr-3 ${!isYearly ? 'text-gray-900' : 'text-gray-500'}`}>Monthly</span>
                <button
                  onClick={() => setIsYearly(!isYearly)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                    isYearly ? 'bg-indigo-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isYearly ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className={`text-sm font-medium ml-3 ${isYearly ? 'text-gray-900' : 'text-gray-500'}`}>Yearly</span>
                {isYearly && (
                  <span className="ml-2 bg-green-100 text-green-800 text-xs font-medium px-2 py-1 rounded-full">Save 50%</span>
                )}
              </div>
            </div>

            {/* Body */}
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
                {/* ---- Free ---- */}
                <div
                  className={`border-2 rounded-lg p-6 flex flex-col h-full ${
                    effectiveTier === 'free' ? 'border-gray-400 bg-gray-50' : 'border-gray-200'
                  }`}
                >
                  {effectiveTier === 'free' && (
                    <div className="bg-gray-600 text-white text-xs font-medium px-2 py-1 rounded-full inline-block mb-4">
                      Current Plan
                    </div>
                  )}

                  <div className="text-center mb-6 min-h-36 flex flex-col justify-end">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Free</h3>
                    <div className="text-2xl font-bold text-gray-900">
                      €0<span className="text-sm font-normal text-gray-600">/month</span>
                    </div>
                    {isYearly && <div className="text-xs text-gray-600 mt-1">Billed annually (€0/year)</div>}
                  </div>

                  <ul className="space-y-3">
                    <li className="flex items-center">
                      <Check className="h-4 w-4 text-green-600 mr-2" />
                      <span>20,000 words / month</span>
                    </li>
                    <li className="flex items-center">
                      <Check className="h-4 w-4 text-green-600 mr-2" />
                      <span>Words per chapter: <strong>1,000–1,500</strong></span>
                    </li>
                    <li className="flex items-center">
                      <Check className="h-4 w-4 text-green-600 mr-2" />
                      <span>5 chapters per book</span>
                    </li>
                    <li className="flex items-center">
                      <Check className="h-4 w-4 text-green-600 mr-2" />
                      <span>3 active projects</span>
                    </li>
                    <li className="flex items-center">
                      <Check className="h-4 w-4 text-green-600 mr-2" />
                      <span>Export to PDF</span>
                    </li>
                    <li className="flex items-center opacity-60">
                      <Check className="h-4 w-4 text-gray-300 mr-2" />
                      <span>Rewrite chapters (Pro & Premium)</span>
                    </li>
                  </ul>

                  <div className="mt-auto pt-8">
                    <button
                      disabled={effectiveTier === 'free'}
                      onClick={async () => {
                        if (effectiveTier !== 'free') await openBillingPortal();
                      }}
                      className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
                        effectiveTier === 'free'
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-gray-600 text-white hover:bg-gray-700'
                      }`}
                    >
                      {effectiveTier === 'free' ? 'Current Plan' : 'Downgrade to Free'}
                    </button>
                  </div>
                </div>

                {/* ---- Pro ---- */}
                <div
                  className={`border-2 rounded-lg p-6 relative flex flex-col h-full ${
                    effectiveTier === 'pro' ? 'border-blue-400 bg-blue-50' : 'border-gray-200'
                  }`}
                >
                  {effectiveTier === 'pro' && (
                    <div className="bg-blue-600 text-white text-xs font-medium px-2 py-1 rounded-full inline-block mb-4">
                      Current Plan
                    </div>
                  )}
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="bg-blue-500 text-white px-3 py-1 rounded-full text-xs font-medium">Most Popular</span>
                  </div>

                  <div className="text-center mb-6 min-h-36 flex flex-col justify-end">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Pro</h3>
                    <div className="text-2xl font-bold text-gray-900">
                      €{isYearly ? '9.90' : '19.90'}
                      <span className="text-sm font-normal text-gray-600">/month</span>
                    </div>
                    {isYearly && <div className="text-xs text-gray-600 mt-1">Billed annually (€{(9.9 * 12).toFixed(2)}/year)</div>}
                  </div>

                  <ul className="space-y-3">
                    <li className="flex items-center">
                      <Check className="h-4 w-4 text-green-600 mr-2" />
                      <span>500,000 words / month</span>
                    </li>
                    <li className="flex items-center">
                      <Check className="h-4 w-4 text-green-600 mr-2" />
                      <span>Words per chapter: <strong>2,500–4,000</strong></span>
                    </li>
                    <li className="flex items-center">
                      <Check className="h-4 w-4 text-green-600 mr-2" />
                      <span>50 chapters per book</span>
                    </li>
                    <li className="flex items-center">
                      <Check className="h-4 w-4 text-green-600 mr-2" />
                      <span>10 active projects</span>
                    </li>
                    <li className="flex items-center">
                      <Check className="h-4 w-4 text-green-600 mr-2" />
                      <span>Export to PDF</span>
                    </li>
                    <li className="flex items-center">
                      <Check className="h-4 w-4 text-green-600 mr-2" />
                      <span>Rewrite chapters</span>
                    </li>
                  </ul>

                  <div className="mt-auto pt-8">
                    <button
                      disabled={effectiveTier === 'pro'}
                      onClick={async () => {
                        if (effectiveTier !== 'pro') {
                          await startCheckout({ plan: 'pro', interval: isYearly ? 'year' : 'month' });
                        }
                      }}
                      className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
                        effectiveTier === 'pro'
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {effectiveTier === 'pro' ? 'Current Plan' : 'Upgrade to Pro'}
                    </button>
                  </div>
                </div>

                {/* ---- Premium ---- */}
                <div
                  className={`border-2 rounded-lg p-6 flex flex-col h-full ${
                    effectiveTier === 'premium' ? 'border-purple-400 bg-purple-50' : 'border-gray-200'
                  }`}
                >
                  {effectiveTier === 'premium' && (
                    <div className="bg-purple-600 text-white text-xs font-medium px-2 py-1 rounded-full inline-block mb-4">
                      Current Plan
                    </div>
                  )}

                  <div className="text-center mb-6 min-h-36 flex flex-col justify-end">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Premium</h3>
                    <div className="text-2xl font-bold text-gray-900">
                      €{isYearly ? '14.90' : '29.90'}
                      <span className="text-sm font-normal text-gray-600">/month</span>
                    </div>
                    {isYearly && <div className="text-xs text-gray-600 mt-1">Billed annually (€{(14.9 * 12).toFixed(2)}/year)</div>}
                  </div>

                  <ul className="space-y-3">
                    <li className="flex items-center">
                      <Check className="h-4 w-4 text-green-600 mr-2" />
                      <span>2,000,000 words / month</span>
                    </li>
                    <li className="flex items-center">
                      <Check className="h-4 w-4 text-green-600 mr-2" />
                      <span>Words per chapter: <strong>4,000–6,000</strong></span>
                    </li>
                    <li className="flex items-center">
                      <Check className="h-4 w-4 text-green-600 mr-2" />
                      <span>100 chapters per book</span>
                    </li>
                    <li className="flex items-center">
                      <Check className="h-4 w-4 text-green-600 mr-2" />
                      <span>20 active projects</span>
                    </li>
                    <li className="flex items-center">
                      <Check className="h-4 w-4 text-green-600 mr-2" />
                      <span>Export to PDF</span>
                    </li>
                    <li className="flex items-center">
                      <Check className="h-4 w-4 text-green-600 mr-2" />
                      <span>Rewrite chapters</span>
                    </li>
                  </ul>

                  <div className="mt-auto pt-8">
                    <button
                      disabled={effectiveTier === 'premium'}
                      onClick={async () => {
                        if (effectiveTier !== 'premium') {
                          await startCheckout({ plan: 'premium', interval: isYearly ? 'year' : 'month' });
                        }
                      }}
                      className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
                        effectiveTier === 'premium'
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-purple-600 text-white hover:bg-purple-700'
                      }`}
                    >
                      {effectiveTier === 'premium' ? 'Current Plan' : 'Upgrade to Premium'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && bookToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center mr-3">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Delete Book</h2>
            </div>

            <p className="text-gray-600 mb-6">
              Are you sure you want to delete "<strong>{bookToDelete.title}</strong>"? This action cannot be undone and
              will permanently remove the book and all its chapters.
            </p>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setBookToDelete(null);
                }}
                disabled={isDeleting}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteBook}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center"
              >
                {isDeleting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Book
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
