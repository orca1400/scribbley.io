// src/components/SettingsPanel.tsx
import React, { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { X, Save, Download, Trash2, LogOut, Shield, Eye, Clock, Database, HardDrive } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { startCheckout, openBillingPortal } from '../lib/billing';
import { clearSessionCookie } from '../lib/session';
import { CONSENT_VERSION } from '../config/plans';
import { BackupPanel } from './BackupPanel';

type Profile = {
  id: string;
  display_name?: string | null;
  bio?: string | null;
  ui_language?: string | null;
  book_language?: string | null;
  timezone?: string | null;
  avatar_url?: string | null;

  // Billing / plan
  plan_tier?: 'free' | 'pro' | 'premium';
  monthly_word_limit?: number | null;
  projects_limit?: number | null;
  rewrites_unlimited?: boolean | null;
  subscription_status?: string | null;
  subscription_interval?: 'month' | 'year' | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
  paused?: boolean | null;

  // Privacy & AI Consent
  ai_processing_consent: boolean;
  ai_consent_at: string | null;
  ai_consent_version: string | null;
  allow_training: boolean;
  content_retention_days: number;
  log_retention_days: number;
  default_visibility: 'private' | 'public' | 'unlisted';
  gdpr_acknowledged_at: string | null;
};

type TrackedSession = {
  id: string;
  is_guest: boolean;
  created_at: string;
};

type SettingsPanelProps = {
  user: User;
  profile: Profile;
  onClose: () => void;
  onSave: (patch: Partial<Profile>) => Promise<void>;
};

export function SettingsPanel({ user, profile, onClose, onSave }: SettingsPanelProps) {
  // Basic profile states
  const [displayName, setDisplayName] = useState(profile.display_name ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [uiLanguage, setUiLanguage] = useState(profile.ui_language ?? 'en');
  const [bookLanguage, setBookLanguage] = useState(profile.book_language ?? 'en');
  const [timezone, setTimezone] = useState(profile.timezone ?? 'Europe/Vienna');
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url ?? '');

  // Privacy & AI consent states
  const [aiConsent, setAiConsent] = useState(profile.ai_processing_consent ?? false);
  const [allowTraining, setAllowTraining] = useState(profile.allow_training ?? false);
  const [contentRetention, setContentRetention] = useState<number>(profile.content_retention_days ?? 365);
  const [logRetention, setLogRetention] = useState<number>(profile.log_retention_days ?? 90);
  const [defaultVisibility, setDefaultVisibility] = useState<Profile['default_visibility']>(
    profile.default_visibility ?? 'private'
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Sessions
  const [sessions, setSessions] = useState<TrackedSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [revokingAll, setRevokingAll] = useState(false);

  // Account actions
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showBackupPanel, setShowBackupPanel] = useState(false);

  const languages = ['en', 'de', 'es', 'fr', 'it'];
  const timezones = ['Europe/Vienna', 'Europe/Berlin', 'UTC', 'America/New_York', 'Asia/Singapore'];
  const visibilityOptions: Profile['default_visibility'][] = ['private', 'public', 'unlisted'];
  const retentionOptions = [
    { value: 30, label: '30 days' },
    { value: 90, label: '90 days' },
    { value: 180, label: '6 months' },
    { value: 365, label: '1 year' },
    { value: 730, label: '2 years' },
    { value: -1, label: 'Never delete' },
  ];

  // Sync profile values when component opens or profile changes
  useEffect(() => {
    setDisplayName(profile.display_name ?? '');
    setBio(profile.bio ?? '');
    setUiLanguage(profile.ui_language ?? 'en');
    setBookLanguage(profile.book_language ?? 'en');
    setTimezone(profile.timezone ?? 'Europe/Vienna');
    setAvatarUrl(profile.avatar_url ?? '');
    setAiConsent(profile.ai_processing_consent ?? false);
    setAllowTraining(profile.allow_training ?? false);
    setContentRetention(profile.content_retention_days ?? 365);
    setLogRetention(profile.log_retention_days ?? 90);
    setDefaultVisibility(profile.default_visibility ?? 'private');
  }, [profile]);

  // Load sessions
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingSessions(true);
        const { data, error } = await supabase
          .from('sessions')
          .select('id,is_guest,created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        if (!cancelled) setSessions(data || []);
      } catch (e) {
        console.error('load sessions failed', e);
      } finally {
        if (!cancelled) setLoadingSessions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  // Auto-hide "Saved!" after 2s
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(t);
  }, [saved]);

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);

      const updates: Partial<Profile> = {
        display_name: displayName.trim() || null,
        bio: bio.trim() || null,
        ui_language: uiLanguage,
        book_language: bookLanguage,
        timezone,
        avatar_url: avatarUrl.trim() || null,
        ai_processing_consent: aiConsent,
        allow_training: allowTraining,
        content_retention_days: contentRetention,
        log_retention_days: logRetention,
        default_visibility: defaultVisibility,
      };

      // Record consent timestamp/version the first time it’s granted
      if (aiConsent && (!profile.ai_processing_consent || !profile.ai_consent_at)) {
        updates.ai_consent_at = new Date().toISOString();
        updates.ai_consent_version = CONSENT_VERSION;
      }

      await onSave(updates);
      setSaved(true);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOutEverywhere() {
    try {
      setRevokingAll(true);
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) throw error;
      alert('Signed out on all devices. Please sign in again.');
    } catch (e: any) {
      alert(e?.message ?? 'Failed to sign out everywhere.');
    } finally {
      setRevokingAll(false);
    }
  }

  async function handleLogout() {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (e) {
      console.error('Logout error:', e);
    } finally {
      try {
        clearSessionCookie();
      } catch {}
      onClose?.();
      window.location.href = '/';
    }
  }

  async function handleExport() {
    try {
      setExporting(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        alert('Not authenticated.');
        return;
      }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-data`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await res.text());

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `export-${ts}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e?.message ?? 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteAccount() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      setDeleting(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        alert('Not authenticated.');
        return;
      }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-account`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt || 'Delete failed');

      alert('Your account was deleted.');
      onClose();
      await supabase.auth.signOut({ scope: 'local' });
      window.location.href = '/';
    } catch (e: any) {
      alert(e?.message ?? 'Delete failed.');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const planName = (tier?: string | null) =>
    tier === 'premium' ? 'Premium' : tier === 'pro' ? 'Pro' : 'Free';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Settings</h2>
          <button className="p-2 rounded-lg hover:bg-gray-100" onClick={onClose} aria-label="Close">
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6 space-y-8">
          {/* Account */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Account</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Email</label>
                <input value={user.email ?? ''} disabled className="w-full rounded-lg border bg-gray-50 px-3 py-2 text-gray-600" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Plan</label>
                <input value={planName(profile.plan_tier)} disabled className="w-full rounded-lg border bg-gray-50 px-3 py-2 text-gray-600" />
              </div>
            </div>
          </section>

          {/* Profile */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Profile</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Display name</label>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full rounded-lg border px-3 py-2" maxLength={60} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Avatar URL</label>
                <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} className="w-full rounded-lg border px-3 py-2" placeholder="https://..." />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Bio</label>
                <textarea value={bio} onChange={(e) => setBio(e.target.value)} className="w-full rounded-lg border px-3 py-2" rows={3} maxLength={280} />
              </div>
            </div>
          </section>

          {/* Preferences */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Preferences</h3>
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">UI language</label>
                <select value={uiLanguage} onChange={(e) => setUiLanguage(e.target.value)} className="w-full rounded-lg border px-3 py-2">
                  {languages.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Default book language</label>
                <select value={bookLanguage} onChange={(e) => setBookLanguage(e.target.value)} className="w-full rounded-lg border px-3 py-2">
                  {languages.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Timezone</label>
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full rounded-lg border px-3 py-2">
                  {timezones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Privacy & AI Consent */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5 text-blue-600" />
              <h3 className="text-sm font-semibold text-gray-700">Privacy & AI Consent</h3>
            </div>

            <div className="space-y-6">
              {/* AI Processing Consent */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="ai-consent"
                    checked={aiConsent}
                    onChange={(e) => setAiConsent(e.target.checked)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <label htmlFor="ai-consent" className="font-medium text-blue-900 cursor-pointer">
                      AI Processing Consent
                    </label>
                    <p className="text-sm text-blue-800 mt-1">
                      I consent to my book prompts and content being processed by OpenAI (USA) for content generation.
                      I understand that OpenAI may process this data according to their privacy policy and that I should avoid entering personal data.
                    </p>
                    {profile.ai_consent_at && (
                      <p className="text-xs text-blue-600 mt-2">
                        Consent given: {new Date(profile.ai_consent_at).toLocaleString()}
                        {profile.ai_consent_version && ` (v${profile.ai_consent_version})`}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Training Data Opt-in */}
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="allow-training"
                  checked={allowTraining}
                  onChange={(e) => setAllowTraining(e.target.checked)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <label htmlFor="allow-training" className="font-medium text-gray-700 cursor-pointer">
                    Allow Training Data Usage
                  </label>
                  <p className="text-sm text-gray-600 mt-1">
                    Allow your content to be used (anonymized/aggregated) for improving AI models (optional).
                  </p>
                </div>
              </div>

              {/* Data Retention Settings */}
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Content retention
                  </label>
                  <select
                    value={contentRetention}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setContentRetention(Number.isNaN(v) ? 0 : v);
                    }}
                    className="w-full rounded-lg border px-3 py-2"
                  >
                    {retentionOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
                    <Database className="w-3 h-3" />
                    Log retention
                  </label>
                  <select
                    value={logRetention}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setLogRetention(Number.isNaN(v) ? 0 : v);
                    }}
                    className="w-full rounded-lg border px-3 py-2"
                  >
                    {retentionOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Default Visibility */}
              <div>
                <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  Default book visibility
                </label>
                <select
                  value={defaultVisibility}
                  onChange={(e) => setDefaultVisibility(e.target.value as Profile['default_visibility'])}
                  className="w-full rounded-lg border px-3 py-2 max-w-xs"
                >
                  {visibilityOptions.map((vis) => (
                    <option key={vis} value={vis}>
                      {vis.charAt(0).toUpperCase() + vis.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              {/* GDPR Acknowledgment */}
              {profile.gdpr_acknowledged_at && (
                <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
                  GDPR terms acknowledged: {new Date(profile.gdpr_acknowledged_at).toLocaleString()}
                </div>
              )}
            </div>
          </section>

          {/* Devices & Sessions */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Devices & Sessions</h3>
              <div className="flex gap-2">
                <button
                  onClick={handleLogout}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-gray-700 hover:bg-white"
                  title="Sign out on this device"
                >
                  <LogOut className="w-4 h-4" />
                  Log out (this device)
                </button>
                <button
                  onClick={handleSignOutEverywhere}
                  disabled={revokingAll}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-gray-700 hover:bg-white disabled:opacity-60"
                  title="Sign out on all devices"
                >
                  <LogOut className="w-4 h-4" />
                  {revokingAll ? 'Signing out…' : 'Sign out everywhere'}
                </button>
              </div>
            </div>

            <div className="rounded-lg border">
              <div className="divide-y">
                {loadingSessions ? (
                  <div className="p-4 text-sm text-gray-500">Loading…</div>
                ) : sessions.length === 0 ? (
                  <div className="p-4 text-sm text-gray-500">No tracked sessions.</div>
                ) : (
                  sessions.map((s) => (
                    <div key={s.id} className="p-4 flex items-center justify-between">
                      <div className="text-sm">
                        <div className="font-medium text-gray-800">
                          {s.is_guest ? 'Guest session' : 'Authenticated session'}
                        </div>
                        <div className="text-gray-500">Created: {new Date(s.created_at).toLocaleString()}</div>
                      </div>
                      <div className="text-xs text-gray-500">Tracked only</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <p className="text-xs text-gray-500 mt-2">
              Note: “Sign out everywhere” revokes your Supabase auth on all devices (including this one).
            </p>
          </section>

          {/* Subscription & Billing */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Subscription & Billing</h3>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-lg border p-4 bg-white">
                <div className="text-sm text-gray-600">Current plan</div>
                <div className="mt-1 text-lg font-semibold">
                  {planName(profile.plan_tier)}
                  {profile.paused ? (
                    <span className="ml-2 text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">paused</span>
                  ) : null}
                </div>
                <div className="mt-2 text-sm text-gray-600">
                  Words/month: {profile.monthly_word_limit?.toLocaleString() ?? '—'}
                  <br />
                  Projects: {profile.projects_limit ?? '—'}
                  <br />
                  Rewrites: {profile.rewrites_unlimited ? 'unlimited' : '—'}
                </div>
              </div>

              <div className="rounded-lg border p-4 bg-white">
                <div className="text-sm text-gray-600">Subscription</div>
                <div className="mt-1 text-sm text-gray-700">
                  Status: {profile.subscription_status ?? '—'}
                  <br />
                  Interval: {profile.subscription_interval ?? '—'}
                  <br />
                  Current period end:{' '}
                  {profile.current_period_end ? new Date(profile.current_period_end).toLocaleDateString() : '—'}
                  <br />
                  Cancel at period end: {profile.cancel_at_period_end ? 'Yes' : 'No'}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              {/* Upgrade Buttons via Stripe Checkout */}
              {profile.plan_tier !== 'pro' && (
                <>
                  <button
                    onClick={() => startCheckout({ plan: 'pro', interval: 'month' })}
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                  >
                    Upgrade to PRO (Monthly)
                  </button>
                  <button
                    onClick={() => startCheckout({ plan: 'pro', interval: 'year' })}
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                  >
                    Upgrade to PRO (Yearly)
                  </button>
                </>
              )}
              {profile.plan_tier !== 'premium' && (
                <>
                  <button
                    onClick={() => startCheckout({ plan: 'premium', interval: 'month' })}
                    className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700"
                  >
                    Upgrade to PREMIUM (Monthly)
                  </button>
                  <button
                    onClick={() => startCheckout({ plan: 'premium', interval: 'year' })}
                    className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700"
                  >
                    Upgrade to PREMIUM (Yearly)
                  </button>
                </>
              )}

              {/* Billing portal: payment methods, invoices, downgrade, cancel, pause */}
              <button
                onClick={openBillingPortal}
                className="px-4 py-2 rounded-lg border text-gray-700 hover:bg-white"
                title="Manage payment method, invoices, downgrade, cancel, pause"
              >
                Open Billing Portal
              </button>
            </div>

            <p className="text-xs text-gray-500 mt-2">
              Upgrades are immediate (prorated automatically). Downgrades/cancellations/pauses take effect at the end of
              the current period—manage these in the Stripe portal.
            </p>
          </section>

          {/* Data & Account */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Data & Account</h3>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setShowBackupPanel(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-gray-700 hover:bg-white"
              >
                <HardDrive className="w-4 h-4" />
                Backup & Restore
              </button>

              <button
                onClick={handleExport}
                disabled={exporting}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-gray-700 hover:bg-white disabled:opacity-60"
              >
                <Download className="w-4 h-4" />
                {exporting ? 'Exporting…' : 'Export my data'}
              </button>

              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg ${
                  confirmDelete ? 'bg-red-600 text-white hover:bg-red-700' : 'border text-red-600 hover:bg-red-50'
                }`}
              >
                <Trash2 className="w-4 h-4" />
                {deleting ? 'Deleting…' : confirmDelete ? 'Confirm delete account' : 'Delete my account'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Backup creates a complete copy of your data. Export creates a simple JSON file. 
              Deleting your account permanently removes your profile, books, summaries, and usage records.
            </p>
          </section>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
          <div className={`text-sm ${saved ? 'text-green-700' : 'text-gray-500'}`}>
            {saved ? 'Saved!' : 'Make changes and click Save'}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border text-gray-700 hover:bg-white" disabled={saving}>
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? (
                <span className="inline-flex items-center">
                  <span className="w-4 h-4 border-2 border-white/70 border-t-transparent rounded-full animate-spin mr-2" />
                  Saving…
                </span>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Backup Panel */}
      {showBackupPanel && (
        <BackupPanel
          userId={user.id}
          onClose={() => setShowBackupPanel(false)}
        />
      )}
    </div>
  );
}
