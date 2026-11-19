'use client';

/**
 * AnnouncementSettings — Exactly Four Controls
 *
 * 1. Sound ON/OFF
 * 2. Language selection (Hindi | English only)
 * 3. Voice selection (device + Edge catalogue)
 * 4. Test voice
 *
 * No: speed, dialect, Hinglish, desi toggle, priority, replay, categories.
 */

import { useAnnouncementsOptional } from './GlobalAnnouncementProvider';
import { SwitchTrack, Segmented, btn } from '@/components/owner/chrome';

export function AnnouncementSettings() {
  const ctx = useAnnouncementsOptional();

  // Render nothing in demo / outside provider — settings are per-restaurant
  if (!ctx) {
    return (
      <div className="rounded-lg border border-hair bg-card p-4">
        <p className="text-sm text-gink-46">Announcement settings appear when a restaurant is active.</p>
      </div>
    );
  }

  const { settings, setSettings, hindiVoices, englishVoices, voiceState, voiceName, voiceAvailable, testVoice, enableSound } = ctx;

  const lang = settings.lang;
  const voices = lang === 'hi' ? hindiVoices : englishVoices;

  return (
    <section aria-labelledby="announcement-settings-heading" className="rounded-[var(--p-r-card)] border border-hair bg-card">
      <div className="border-b border-hair px-4 py-3">
        <h2 id="announcement-settings-heading" className="text-sm font-semibold text-gink">
          Announcements
        </h2>
        <p className="mt-0.5 text-xs leading-snug text-gink-46">
          Kitchen announcements for new orders and waiter calls. Written notifications always appear.
        </p>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4">
        {/* 1. Sound ON/OFF */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gink">Sound</p>
            <p className="text-xs text-gink-46">Voice announcements for new orders and waiter calls</p>
          </div>
          <button
            type="button"
            aria-pressed={settings.soundOn}
            aria-label={settings.soundOn ? 'Sound on — turn off' : 'Sound off — turn on'}
            onClick={() => {
              const next = !settings.soundOn;
              if (next) enableSound();
              else setSettings({ soundOn: false });
            }}
            className={`inline-flex h-8 items-center gap-2 rounded-full px-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)] ${settings.soundOn ? 'text-gink' : 'text-gink-64 hover:text-gink'}`}
          >
            <SwitchTrack on={settings.soundOn} />
            {settings.soundOn ? 'On' : 'Off'}
          </button>
        </div>

        {/* 2. Language selection — Hindi | English only */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gink">Language</p>
            <p className="text-xs text-gink-46">Announcement language</p>
          </div>
          <Segmented
            label="Announcement language"
            size="sm"
            value={lang}
            onChange={(next) => setSettings({ lang: next as 'hi' | 'en' })}
            options={[
              { value: 'hi', label: 'हिन्दी' },
              { value: 'en', label: 'English' },
            ]}
          />
        </div>

        {/* 3. Voice selection */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gink">Voice</p>
            <p className="text-xs text-gink-46">
              {voiceState === 'starting'
                ? 'Detecting voices…'
                : voiceState === 'ready'
                  ? voiceName
                    ? `${voiceName} · ready`
                    : 'Ready'
                  : 'No voice on this device — install a system voice or check network'}
            </p>
          </div>
          {voices.length > 0 ? (
            <select
              aria-label="Voice"
              value={settings.voiceName ?? ''}
              onChange={(e) => setSettings({ voiceName: e.target.value || null })}
              className="h-9 max-w-[200px] rounded-[var(--p-r-control)] border border-hair-strong bg-card px-2.5 pr-7 text-xs text-gink focus:border-[var(--p-accent)] focus:outline-none"
            >
              <option value="">Auto</option>
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} {v.lang ? `· ${v.lang}` : ''}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-gink-46">
              {voiceState === 'no-voice' ? 'No voice available' : 'Auto'}
            </span>
          )}
        </div>

        {/* 4. Test voice */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gink">Test voice</p>
            <p className="text-xs text-gink-46">
              {voiceAvailable && settings.soundOn
                ? 'Play a sample announcement'
                : !settings.soundOn
                  ? 'Turn Sound on to test voice'
                  : 'Voice not available — check Sound and Voice above'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => testVoice()}
            disabled={!voiceAvailable || !settings.soundOn}
            className={btn('quiet', 'sm') + ' shrink-0 disabled:opacity-40 disabled:cursor-not-allowed'}
          >
            Test sample order
          </button>
        </div>
      </div>

      <p className="border-t border-hair px-4 py-2 text-[11px] leading-snug text-gink-46">
        Written notifications appear on every page. Voice requires Sound on and a browser gesture (tap once anywhere). If the browser blocks audio, written notifications still work.
      </p>
    </section>
  );
}
