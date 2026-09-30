import { useEffect, useState } from 'preact/hooks';
import { PATTERNS } from '../core/constants';
import type { Lull } from '../core/lull';
import { byDay, dayKey, monthGrid, streaks, type Session } from '../core/practice';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const monthName = (y: number, m: number) => new Date(y, m, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
const dayTitle = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
};
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const mins = (seconds: number) => Math.max(1, Math.round(seconds / 60));
const rounds = (n: number) => `${n} round${n === 1 ? '' : 's'}`;

/** A moon that waxes with the day's minutes toward the daily goal: a sliver for a short session, full at the goal. */
function Moon({ minutes, goal }: { minutes: number; goal: number }) {
  if (!minutes) return <span class="pday-moon empty" />;
  const f = Math.min(1, minutes / goal);
  // An inset shadow from the right hides the unlit part, the classic CSS moon phase.
  return <span class="pday-moon" style={{ '--shade': `${(1 - f) * 0.9}` } as Record<string, string>} />;
}

/** Your practice: streaks and a month of breathing, from the Relax screen. */
export function Practice({ core, onClose }: { core: Lull; onClose: () => void }) {
  const log = core.practice, goal = core.s.relax.goal;
  const sessions: Session[] = log?.sessions ?? [];
  const today = dayKey(Date.now());
  const [ty, tm] = today.split('-').map(Number);
  const [month, setMonth] = useState({ y: ty, m: tm - 1 });
  const [picked, setPicked] = useState<string>(today);

  // Fresh numbers from the server when the calendar opens (quietly does nothing offline).
  useEffect(() => { log?.sync(); }, [log]);

  const days = byDay(sessions), { current, longest } = streaks(days.keys(), today);
  const prefix = `${month.y}-${String(month.m + 1).padStart(2, '0')}`;
  let monthMin = 0, monthCount = 0;
  for (const [k, d] of days) if (k.startsWith(prefix)) { monthMin += d.minutes; monthCount += d.count; }
  const shift = (n: number) => setMonth(({ y, m }) => ({ y: y + Math.floor((m + n) / 12), m: (((m + n) % 12) + 12) % 12 }));
  const isThisMonth = month.y === ty && month.m === tm - 1;
  const day = days.get(picked);

  return (
    <>
      <div class="menu-backdrop" onClick={onClose} />
      <div class="practice" role="dialog" aria-label="Your practice">
        <div class="row-between">
          <span class="practice-title">Your practice</span>
          <button class="done" onClick={onClose}>Done</button>
        </div>

        <div class="pstats">
          <div class="pstat"><span class="pstat-n">{current}</span><span class="note">{current === 1 ? 'day' : 'days'} in a row</span></div>
          <div class="pstat"><span class="pstat-n">{longest}</span><span class="note">longest streak</span></div>
          <div class="pstat"><span class="pstat-n">{Math.round(monthMin)}</span><span class="note">min in {new Date(month.y, month.m, 1).toLocaleDateString([], { month: 'short' })}</span></div>
        </div>

        <div class="pcal">
          <div class="pcal-head">
            <button class="pcal-nav" aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
            <span class="pcal-month">{monthName(month.y, month.m)}</span>
            <button class="pcal-nav" aria-label="Next month" disabled={isThisMonth} onClick={() => shift(1)}>›</button>
          </div>
          <div class="pcal-grid" role="grid">
            {WEEKDAYS.map((w, i) => <span key={`w${i}`} class="pcal-wd" aria-hidden="true">{w}</span>)}
            {monthGrid(month.y, month.m).flat().map((k, i) => {
              if (!k) return <span key={`e${i}`} />;
              const d = days.get(k), future = k > today;
              return (
                <button
                  key={k}
                  class={`pday${k === today ? ' today' : ''}${k === picked ? ' picked' : ''}${future ? ' future' : ''}`}
                  disabled={future}
                  aria-label={`${dayTitle(k)}${d ? `, ${Math.round(d.minutes)} minutes` : ''}`}
                  onClick={() => setPicked(k)}
                >
                  <span class="pday-n">{Number(k.slice(8))}</span>
                  <Moon minutes={d?.minutes ?? 0} goal={goal} />
                  {/* A dot per session (up to three): practice spread through the day shows at a glance. */}
                  <span class="pday-dots" aria-hidden="true">{Array.from({ length: Math.min(3, d?.count ?? 0) }, (_, j) => <i key={j} />)}</span>
                </button>
              );
            })}
          </div>
          <span class="note pcal-sum">{monthCount ? `${monthCount} session${monthCount === 1 ? '' : 's'} this month` : 'No sessions this month yet.'}</span>
        </div>

        <div class="pday-detail">
          <div class="row-between">
            <span class="label">{picked === today ? 'Today' : dayTitle(picked)}</span>
            {day && <span class="note">{Math.round(day.minutes)} of {goal} min{day.minutes >= goal ? ' · goal met' : ''}</span>}
          </div>
          {day ? (
            <div class="list">
              {day.sessions.map(s => (
                <div key={s.id} class="list-row">
                  <div class="main">
                    <span class="title">{PATTERNS[s.pattern].name} · {mins(s.seconds)} min</span>
                    <span class="note">{time(s.started_at)} · {rounds(s.rounds)} · {s.completed ? 'finished' : 'stopped early'}</span>
                  </div>
                  <button class="x" aria-label="Remove this session" onClick={() => log?.remove(s.id)}>×</button>
                </div>
              ))}
            </div>
          ) : (
            <span class="note">{picked === today ? 'Nothing yet today. A minute or more of breathing counts.' : 'No breathing this day.'}</span>
          )}
        </div>

        <span class="muted pfoot">
          Your breathing sessions (pattern, time and length) are saved to your account, so they follow you to other devices. Your sounds and mixes never leave this device.
        </span>
      </div>
    </>
  );
}
