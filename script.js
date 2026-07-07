/*
 * FytRun
 * Netlify static frontend + Supabase Auth / Postgres / Storage.
 *
 * 1) Create a Supabase project.
 * 2) Run SUPABASE_SETUP.sql in the Supabase SQL Editor.
 * 3) Paste the project URL and browser-safe publishable key below.
 * 4) In Supabase Auth > URL Configuration, add your Netlify URL as a Redirect URL.
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const CONFIG = 
{ supabaseUrl: 'https://rxhjinknzuylsmxpjtkl.supabase.co',
  supabasePublishableKey: 'sb_publishable_18xCFx2a9J0pP4n0LOu5lw_W56aXL35',
};

const isConfigured = !CONFIG.supabaseUrl.includes('PASTE_') && !CONFIG.supabasePublishableKey.includes('PASTE_');
const supabase = isConfigured ? createClient(CONFIG.supabaseUrl, CONFIG.supabasePublishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  user: null,
  profile: null,
  runs: [],
  relationships: [],
  friends: [],
  pendingRequests: [],
  charts: {},
  activeView: 'dashboard',
  dashboardRange: '30',
  progressRange: '90',
  calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  editingRunId: null,
  viewingFriend: null,
  friendProfile: null,
  friendRuns: [],
  confirmAction: null,
  profilePhotoFile: null,
  isLoading: false,
  liveRun: { running: false, startedAtMs: null, elapsedMs: 0, distanceKm: 0, type: 'Easy', routeName: '' },
};

const TYPE_STYLES = {
  Easy: ['rgba(201,255,85,.13)', 'var(--lime)'],
  Recovery: ['rgba(125,183,255,.13)', 'var(--blue)'],
  'Long Run': ['rgba(255,200,107,.13)', 'var(--gold)'],
  Tempo: ['rgba(255,135,95,.13)', 'var(--orange)'],
  Intervals: ['rgba(255,122,122,.13)', 'var(--danger)'],
  Race: ['rgba(246,157,232,.13)', '#f69de8'],
  Trail: ['rgba(142,219,156,.13)', 'var(--success)'],
  Other: ['rgba(255,255,255,.09)', 'var(--muted)'],
};

function getAchievements() {
  const metric = getDistanceUnit() === 'km';
  const totalTarget = metric ? 80.4672 : 50;
  const centuryTarget = metric ? 160.9344 : 100;
  const longTarget = metric ? 16.09344 : 10;
  const weeklyTarget = metric ? 40.2336 : 25;
  const toKm = value => displayToKm(value, metric ? 'km' : 'mi');
  const text = value => `${Number(value.toFixed(metric ? 1 : 0))} ${metric ? 'km' : 'mi'}`;
  return [
    { id: 'first-run', icon: 'footprints', title: 'First step', copy: 'Log your first run', unlocked: (s) => s.totalRuns >= 1 },
    { id: 'ten-runs', icon: 'layers-3', title: 'Showing up', copy: 'Complete 10 runs', unlocked: (s) => s.totalRuns >= 10 },
    { id: 'fifty-distance', icon: 'map', title: `${text(totalTarget)} club`, copy: `Run ${text(totalTarget)} total`, unlocked: (s) => s.totalDistance >= toKm(totalTarget) },
    { id: 'hundred-distance', icon: 'milestone', title: 'Century', copy: `Run ${text(centuryTarget)} total`, unlocked: (s) => s.totalDistance >= toKm(centuryTarget) },
    { id: 'streak-7', icon: 'flame', title: 'On fire', copy: 'Reach a 7-day streak', unlocked: (s) => s.streak >= 7 },
    { id: 'long-distance', icon: 'mountain', title: 'Double digits', copy: `Log a ${text(longTarget)} run`, unlocked: (s) => s.longestRun >= toKm(longTarget) },
    { id: 'half', icon: 'trophy', title: 'Half way there', copy: 'Log a half marathon', unlocked: (s) => s.longestRun >= 21.0975 },
    { id: 'weekly-volume', icon: 'sunrise', title: 'Early volume', copy: `Run ${text(weeklyTarget)} this week`, unlocked: (s) => s.weeklyDistance >= toKm(weeklyTarget) },
  ];
}

function initIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
}

function setupChartDefaults() {
  if (!window.Chart) return;
  const zoomPlugin = window.ChartZoom || window['chartjs-plugin-zoom'];
  if (zoomPlugin) {
    try { Chart.register(zoomPlugin); } catch (_) { /* already registered */ }
  }
  Chart.defaults.color = getCss('--muted');
  Chart.defaults.font.family = 'Manrope, Arial, sans-serif';
  Chart.defaults.font.size = 10;
  Chart.defaults.animation.duration = 650;
  Chart.defaults.plugins.legend.display = false;
}

function getCss(name) { return getComputedStyle(document.body).getPropertyValue(name).trim(); }
function todayISO() { return dateToISO(new Date()); }
function dateToISO(date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}
function localDate(value) {
  // Run dates are stored as YYYY-MM-DD; profile timestamps are full ISO values.
  // Appending a time to an ISO timestamp produces an invalid date, so only do it
  // for date-only values (at noon to avoid timezone day shifts).
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'number') return new Date(value);
  const text = String(value || '').trim();
  if (!text) return new Date(NaN);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T12:00:00`) : new Date(text);
}
function isValidDate(value) { return !Number.isNaN(localDate(value).getTime()); }
function firstValidDate(...values) { return values.find(isValidDate) || new Date(); }
function isSameDay(a, b) { return dateToISO(a) === dateToISO(b); }
function round(value, digits = 2) { return Number(Number(value || 0).toFixed(digits)); }
function sum(items, getter) { return items.reduce((total, item) => total + Number(getter(item) || 0), 0); }
function escapeHTML(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
}
function initials(name = '') { return name.trim().split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase() || 'R'; }
// Canonical cloud storage: kilometers and meters. Users can switch display/entry units
// without rewriting existing runs, goals, PRs, or shared data.
const KM_PER_MILE = 1.609344;
const METERS_PER_FOOT = 0.3048;
function kmToMiles(km) { return Number(km || 0) / KM_PER_MILE; }
function milesToKm(miles) { return Number(miles || 0) * KM_PER_MILE; }
function getDistanceUnit() { return state.profile?.settings?.distance_unit === 'km' ? 'km' : 'mi'; }
function unitLabel(unit = getDistanceUnit()) { return unit === 'km' ? 'km' : 'mi'; }
function paceUnitLabel(unit = getDistanceUnit()) { return unit === 'km' ? '/km' : '/mi'; }
function elevationUnitLabel(unit = getDistanceUnit()) { return unit === 'km' ? 'm' : 'ft'; }
function kmToDisplay(km, unit = getDistanceUnit()) { return unit === 'km' ? Number(km || 0) : kmToMiles(km); }
function displayToKm(distance, unit = getDistanceUnit()) { return unit === 'km' ? Number(distance || 0) : milesToKm(distance); }
function metersToDisplay(meters, unit = getDistanceUnit()) { return unit === 'km' ? Number(meters || 0) : Number(meters || 0) / METERS_PER_FOOT; }
function displayToMeters(value, unit = getDistanceUnit()) { return unit === 'km' ? Number(value || 0) : Number(value || 0) * METERS_PER_FOOT; }
function cleanInputNumber(value, maxDigits = 2) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '';
  // Inputs should look clean (30, 18.64), while the canonical value is kept in
  // the dataset below so toggling/saving an untouched value never loses precision.
  return String(Number(numeric.toFixed(maxDigits)));
}
function formatUnitInput(km, digits = 2) { return cleanInputNumber(kmToDisplay(km), digits); }
function formatElevationInput(meters, digits = 0) { return cleanInputNumber(metersToDisplay(meters), digits); }
function formatDistance(km, digits = 2, unit = getDistanceUnit()) { return `${kmToDisplay(km, unit).toFixed(digits)} ${unitLabel(unit)}`; }
function formatDistanceValue(km, digits = 2, unit = getDistanceUnit()) { return kmToDisplay(km, unit).toFixed(digits); }
function formatElevation(meters, digits = 0, unit = getDistanceUnit()) { return `${metersToDisplay(meters, unit).toLocaleString(undefined, { maximumFractionDigits: digits })} ${elevationUnitLabel(unit)}`; }
function distanceInputToCanonical(input) {
  if (input?.dataset?.canonicalKm && input.value === input.dataset.renderedValue) return Number(input.dataset.canonicalKm);
  return round(displayToKm(Number(input?.value || 0)), 6);
}
function elevationInputToCanonical(input) {
  if (input?.dataset?.canonicalM && input.value === input.dataset.renderedValue) return Number(input.dataset.canonicalM);
  return round(Math.max(0, displayToMeters(Number(input?.value || 0))), 3);
}
function setDistanceInputFromCanonical(input, distanceKm, digits = 2) {
  if (!input) return;
  const value = formatUnitInput(distanceKm, digits);
  input.value = value; input.dataset.canonicalKm = String(distanceKm); input.dataset.renderedValue = value;
}
function setElevationInputFromCanonical(input, elevationM, digits = 3) {
  if (!input) return;
  const value = String(formatElevationInput(elevationM, digits));
  input.value = value; input.dataset.canonicalM = String(elevationM); input.dataset.renderedValue = value;
}
function normalizeRun(run) {
  return {
    ...run,
    distance_km: Number(run.distance_km || 0),
    duration_seconds: Number(run.duration_seconds || 0),
    elevation_m: Number(run.elevation_m || 0),
    calories: Number(run.calories || 0),
  };
}
function formatDuration(seconds) {
  seconds = Math.max(0, Math.round(Number(seconds || 0)));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function formatDurationShort(seconds) {
  seconds = Math.max(0, Math.round(Number(seconds || 0)));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return `${m}m ${seconds % 60}s`;
}
function formatPace(secondsPerUnit, unit = getDistanceUnit()) {
  if (!Number.isFinite(secondsPerUnit) || secondsPerUnit <= 0) return '—';
  const total = Math.round(secondsPerUnit);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')} ${paceUnitLabel(unit)}`;
}
function formatPaceValue(secondsPerUnit, unit = getDistanceUnit()) { return formatPace(secondsPerUnit, unit).replace(` ${paceUnitLabel(unit)}`, ''); }
function getPace(run, unit = getDistanceUnit()) {
  const distance = kmToDisplay(run?.distance_km || 0, unit);
  return distance > 0 ? Number(run.duration_seconds) / distance : Infinity;
}
function getCanonicalPacePerKm(run) {
  const km = Number(run?.distance_km || 0);
  return km > 0 ? Number(run.duration_seconds) / km : Infinity;
}
function formatDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  const date = localDate(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, options);
}
function formatMonth(date) { return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); }
function startOfDay(date) { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; }
function startOfWeek(date = new Date()) {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}
function startOfMonth(date = new Date()) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function startOfYear(date = new Date()) { return new Date(date.getFullYear(), 0, 1); }
function dateInRange(iso, start, end = new Date()) {
  const d = localDate(iso);
  return d >= startOfDay(start) && d <= new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59);
}
function rangeStart(range, fallback = 30) {
  if (range === 'all') return null;
  const d = startOfDay(new Date());
  d.setDate(d.getDate() - Number(range || fallback) + 1);
  return d;
}
function filterRange(runs, range) {
  const start = rangeStart(range);
  return start ? runs.filter(run => dateInRange(run.date, start)) : [...runs];
}
function plural(number, singular, pluralForm = `${singular}s`) { return `${number} ${number === 1 ? singular : pluralForm}`; }

function getStats(runs = state.runs) {
  const sorted = [...runs].sort((a, b) => a.date.localeCompare(b.date));
  const totalDistance = sum(sorted, run => run.distance_km);
  const totalTime = sum(sorted, run => run.duration_seconds);
  const totalElevation = sum(sorted, run => run.elevation_m);
  const totalRuns = sorted.length;
  const paces = sorted.map(getPace).filter(Number.isFinite);
  const weeklyRuns = sorted.filter(run => dateInRange(run.date, startOfWeek()));
  const monthlyRuns = sorted.filter(run => dateInRange(run.date, startOfMonth()));
  const yearlyRuns = sorted.filter(run => dateInRange(run.date, startOfYear()));
  const longest = sorted.reduce((best, run) => !best || run.distance_km > best.distance_km ? run : best, null);
  const fastest = sorted.reduce((best, run) => !best || getPace(run) < getPace(best) ? run : best, null);
  return {
    totalDistance,
    totalTime,
    totalElevation,
    totalRuns,
    avgPace: totalDistance > 0 ? totalTime / kmToDisplay(totalDistance) : Infinity,
    fastestPace: fastest ? getPace(fastest) : Infinity,
    longestRun: longest?.distance_km || 0,
    longest,
    fastest,
    weeklyDistance: sum(weeklyRuns, run => run.distance_km),
    weeklyRuns: weeklyRuns.length,
    monthlyDistance: sum(monthlyRuns, run => run.distance_km),
    monthlyRuns: monthlyRuns.length,
    yearlyDistance: sum(yearlyRuns, run => run.distance_km),
    yearlyRuns: yearlyRuns.length,
    avgRunLength: totalRuns ? totalDistance / totalRuns : 0,
    streak: currentStreak(sorted),
  };
}

function currentStreak(runs) {
  const dates = new Set(runs.map(run => run.date));
  if (!dates.size) return 0;
  let cursor = startOfDay(new Date());
  if (!dates.has(dateToISO(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (dates.has(dateToISO(cursor))) { count += 1; cursor.setDate(cursor.getDate() - 1); }
  return count;
}

function getPRs(runs = state.runs) {
  const clean = [...runs].filter(run => run.distance_km > 0 && run.duration_seconds > 0);
  const fastestForTarget = (targetKm) => clean.filter(run => run.distance_km >= targetKm).sort((a, b) => getCanonicalPacePerKm(a) - getCanonicalPacePerKm(b))[0] || null;
  const longest = clean.slice().sort((a, b) => b.distance_km - a.distance_km)[0] || null;
  const fastest = clean.slice().sort((a, b) => getCanonicalPacePerKm(a) - getCanonicalPacePerKm(b))[0] || null;
  const standards = getDistanceUnit() === 'km'
    ? [
      { id: '1k', label: 'Fastest 1K', targetKm: 1 },
      { id: '5k', label: 'Fastest 5K', targetKm: 5 },
      { id: '10k', label: 'Fastest 10K', targetKm: 10 },
      { id: 'half', label: 'Half marathon', targetKm: 21.0975 },
      { id: 'marathon', label: 'Marathon', targetKm: 42.195 },
    ]
    : [
      { id: 'mile', label: 'Fastest mile', targetKm: KM_PER_MILE },
      { id: '5k', label: 'Fastest 5K', targetKm: 5 },
      { id: '10k', label: 'Fastest 10K', targetKm: 10 },
      { id: 'half', label: 'Half marathon', targetKm: 21.0975 },
      { id: 'marathon', label: 'Marathon', targetKm: 42.195 },
    ];
  const prs = standards.map(item => {
    const run = fastestForTarget(item.targetKm);
    return { ...item, run, value: run ? Math.round(getCanonicalPacePerKm(run) * item.targetKm) : null, kind: 'finish' };
  });
  prs.push({ id: 'longest', label: 'Longest run', run: longest, value: longest?.distance_km ?? null, kind: 'distance' });
  prs.push({ id: 'pace', label: 'Fastest average pace', run: fastest, value: fastest ? getPace(fastest) : null, kind: 'pace' });
  return prs;
}

function formatPRValue(pr) {
  if (!pr.run) return '—';
  if (pr.kind === 'distance') return formatDistance(pr.value);
  if (pr.kind === 'pace') return formatPace(pr.value);
  return formatDuration(pr.value);
}

function avatarMarkup(profile, classes = '') {
  const label = escapeHTML(initials(profile?.display_name || profile?.email || 'Runner'));
  const fullClasses = `avatar ${classes}`.trim();
  if (profile?.avatar_url) return `<span class="${fullClasses}"><img src="${escapeHTML(profile.avatar_url)}" alt="${escapeHTML(profile.display_name || 'Profile')}" /></span>`;
  const hue = profile?.id ? `avatar-hue-${Math.abs(hashString(profile.id)) % 3 + 1}` : '';
  return `<span class="${fullClasses} ${hue}">${label}</span>`;
}
function hashString(text) { return [...String(text)].reduce((hash, char) => ((hash << 5) - hash) + char.charCodeAt(0) | 0, 0); }
function typePill(type = 'Easy') {
  const [bg, color] = TYPE_STYLES[type] || TYPE_STYLES.Other;
  return `<span class="run-type-pill" style="--pill-bg:${bg};--pill-color:${color}">${escapeHTML(type)}</span>`;
}
function activityIcon(type = 'Easy') {
  const [bg, color] = TYPE_STYLES[type] || TYPE_STYLES.Other;
  const icon = type === 'Trail' ? 'mountain' : type === 'Race' ? 'trophy' : type === 'Intervals' ? 'zap' : 'footprints';
  return `<span class="activity-icon" style="--icon-bg:${bg};--icon-color:${color}"><i data-lucide="${icon}"></i></span>`;
}

function showToast(title, message = '', variant = 'success') {
  const region = $('#toast-region');
  const toast = document.createElement('div');
  toast.className = `toast ${variant}`;
  toast.innerHTML = `<span class="toast-icon"><i data-lucide="${variant === 'error' ? 'circle-x' : 'circle-check'}"></i></span><div><strong>${escapeHTML(title)}</strong>${message ? `<p>${escapeHTML(message)}</p>` : ''}</div>`;
  region.appendChild(toast);
  initIcons();
  setTimeout(() => { toast.classList.add('out'); setTimeout(() => toast.remove(), 250); }, 4200);
}

function setAuthMessage(message = '', isError = true) {
  const el = $('#auth-message');
  el.textContent = message;
  el.style.color = isError ? 'var(--danger)' : 'var(--success)';
}

function showConfigurationMessage() {
  $('#auth-title').textContent = 'Connect FytRun';
  $('#auth-subtitle').textContent = 'Add your Supabase URL and publishable key in script.js to activate cloud accounts and permanent data.';
  $('#sign-in-form').classList.add('hidden');
  $('#register-form').classList.add('hidden');
  $('#auth-switch').classList.add('hidden');
  setAuthMessage('Your frontend is ready. Finish the two-minute Supabase setup in the included README.', false);
}

async function boot() {
  initIcons();
  setupChartDefaults();
  bindEvents();
  restoreLiveRunState();
  renderLiveRun();
  $('#run-date').value = todayISO();
  if (!isConfigured) { showConfigurationMessage(); return; }

  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) showToast('Session check failed', error.message, 'error');
  if (session?.user) await enterApp(session.user);
  else showAuth();

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT') { exitApp(); return; }
    if (session?.user && !state.user) await enterApp(session.user);
  });
}

function showAuth() {
  state.user = null;
  $('#app-shell').classList.add('hidden');
  $('#auth-screen').classList.remove('hidden');
  document.body.classList.remove('app-active');
}
function exitApp() {
  destroyAllCharts();
  state.user = null; state.profile = null; state.runs = []; state.friends = []; state.pendingRequests = [];
  showAuth();
}

async function enterApp(user) {
  state.user = user;
  $('#auth-screen').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');
  document.body.classList.add('app-active');
  await refreshAppData();
  navigateTo(state.activeView || 'dashboard', false);
}

async function refreshAppData({ silent = false } = {}) {
  if (!state.user || state.isLoading) return;
  state.isLoading = true;
  if (!silent) renderLoadingState();
  try {
    await Promise.all([loadProfile(), loadRuns(), loadRelationships()]);
    await hydrateFriends();
    renderAll();
  } catch (error) {
    console.error(error);
    showToast('Could not load your data', error.message || 'Check your Supabase setup and database policies.', 'error');
  } finally {
    state.isLoading = false;
  }
}

async function loadProfile() {
  let { data, error } = await supabase.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
  if (error) throw error;
  if (!data) {
    const fallbackName = state.user.user_metadata?.display_name || state.user.email?.split('@')[0] || 'Runner';
    const { data: inserted, error: insertError } = await supabase.from('profiles').upsert({
      id: state.user.id,
      display_name: fallbackName,
      email: state.user.email,
      joined_at: new Date().toISOString(),
    }).select().single();
    if (insertError) throw insertError;
    data = inserted;
  }
  state.profile = { ...data, settings: data.settings || {} };
}

async function loadRuns() {
  const { data, error } = await supabase.from('runs').select('*').eq('user_id', state.user.id).order('date', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  state.runs = (data || []).map(normalizeRun);
}

async function loadRelationships() {
  const { data, error } = await supabase.from('friend_requests').select('*').or(`sender_id.eq.${state.user.id},receiver_id.eq.${state.user.id}`).order('created_at', { ascending: false });
  if (error) throw error;
  state.relationships = data || [];
  state.pendingRequests = state.relationships.filter(rel => rel.receiver_id === state.user.id && rel.status === 'pending');
}

async function hydrateFriends() {
  const accepted = state.relationships.filter(rel => rel.status === 'accepted');
  const ids = accepted.map(rel => rel.sender_id === state.user.id ? rel.receiver_id : rel.sender_id);
  if (!ids.length) { state.friends = []; return; }
  const data = await fetchProfilesByIds(ids);
  state.friends = (data || []).map(profile => ({ ...profile, settings: profile.settings || {} }));
}

function renderLoadingState() {
  if (state.activeView === 'dashboard') $('#recent-activity').innerHTML = '<div class="center-empty"><div><div class="loading-line"></div>Syncing your training...</div></div>';
}

function renderAll() {
  renderSidebarUser();
  renderTopbar();
  renderDashboard();
  renderHistory();
  renderStatistics();
  renderProgress();
  renderFriends();
  renderProfile();
  renderSettings();
  renderLiveRun();
  if (state.friendProfile) renderFriendProfile();
  initIcons();
}

function renderSidebarUser() {
  const profile = state.profile;
  $('#sidebar-user').innerHTML = `${avatarMarkup(profile)}<div class="user-meta"><strong>${escapeHTML(profile.display_name || 'Runner')}</strong><small>${formatDistance(getStats().totalDistance)} all time</small></div><button id="sidebar-signout" class="signout-mini" type="button" aria-label="Sign out"><i data-lucide="log-out"></i></button>`;
  const topbarAvatar = $('#topbar-avatar');
  if (topbarAvatar) {
    topbarAvatar.outerHTML = avatarMarkup(profile, 'avatar-image').replace('class="avatar', 'id="topbar-avatar" class="avatar');
  }
}
function renderTopbar() {
  const name = state.profile?.display_name?.split(' ')[0] || 'runner';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  if (state.activeView === 'dashboard') $('#page-title').textContent = `${greeting}, ${name}.`;
}

function renderDashboard() {
  const stats = getStats();
  const prs = getPRs();
  const cards = [
    { label: 'TOTAL DISTANCE', value: formatDistanceValue(stats.totalDistance), unit: unitLabel(), sub: 'all time', icon: 'route', accent: 'rgba(201,255,85,.21)' },
    { label: 'TOTAL RUNS', value: stats.totalRuns, unit: '', sub: 'logged sessions', icon: 'layers-3', accent: 'rgba(125,183,255,.2)' },
    { label: 'TOTAL TIME', value: formatDurationShort(stats.totalTime), unit: '', sub: 'time on feet', icon: 'timer', accent: 'rgba(255,200,107,.18)' },
    { label: 'AVERAGE PACE', value: Number.isFinite(stats.avgPace) ? formatPaceValue(stats.avgPace) : '—', unit: paceUnitLabel(), sub: 'across every run', icon: 'gauge', accent: 'rgba(255,135,95,.18)' },
    { label: 'LONGEST RUN', value: formatDistanceValue(stats.longestRun), unit: unitLabel(), sub: stats.longest ? formatDate(stats.longest.date, { month: 'short', day: 'numeric' }) : 'no runs yet', icon: 'mountain', accent: 'rgba(142,219,156,.2)' },
    { label: 'FASTEST PACE', value: Number.isFinite(stats.fastestPace) ? formatPaceValue(stats.fastestPace) : '—', unit: paceUnitLabel(), sub: 'single-run average', icon: 'zap', accent: 'rgba(246,157,232,.18)' },
    { label: 'THIS WEEK', value: formatDistanceValue(stats.weeklyDistance), unit: unitLabel(), sub: plural(stats.weeklyRuns, 'run'), icon: 'calendar-days', accent: 'rgba(201,255,85,.21)' },
    { label: 'THIS MONTH', value: formatDistanceValue(stats.monthlyDistance), unit: unitLabel(), sub: plural(stats.monthlyRuns, 'run'), icon: 'calendar-range', accent: 'rgba(125,183,255,.2)' },
    { label: 'CURRENT STREAK', value: stats.streak, unit: stats.streak === 1 ? 'day' : 'days', sub: stats.streak ? 'keep the chain alive' : 'start one today', icon: 'flame', accent: 'rgba(255,135,95,.2)' },
  ];
  $('#summary-stats').innerHTML = cards.map(card => `<article class="summary-card" style="--card-accent:${card.accent}"><span class="stat-trend"><i data-lucide="${card.icon}"></i></span><small>${card.label}</small><strong>${escapeHTML(String(card.value))} ${card.unit ? `<small>${escapeHTML(card.unit)}</small>` : ''}</strong><span>${escapeHTML(card.sub)}</span></article>`).join('');

  $('#hero-date-label').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
  if (!stats.totalRuns) {
    $('#dashboard-headline').textContent = 'Every run leaves a mark.';
    $('#dashboard-subheadline').textContent = 'Log your first run and turn the blank space into momentum.';
  } else if (stats.streak >= 3) {
    $('#dashboard-headline').textContent = `${stats.streak} days of momentum.`;
    $('#dashboard-subheadline').textContent = 'The streak is real. Keep the promise you made to yourself.';
  } else if (stats.weeklyDistance >= Number(state.profile.weekly_goal_km || 30)) {
    $('#dashboard-headline').textContent = 'Weekly goal, handled.';
    $('#dashboard-subheadline').textContent = `You did the work. Everything else is a bonus ${unitLabel()}.`;
  } else {
    $('#dashboard-headline').textContent = 'The work is compounding.';
    $('#dashboard-subheadline').textContent = `${formatDistance(Math.max(0, Number(state.profile.weekly_goal_km || 30) - stats.weeklyDistance))} to your weekly target.`;
  }

  renderGoal(stats);
  renderRecentActivity();
  renderDashboardPRs(prs);
  renderCalendar();
  renderDashboardChart();
}

function renderGoal(stats) {
  const targetKm = Number(state.profile?.weekly_goal_km || 30);
  const pct = Math.min(100, Math.round((stats.weeklyDistance / targetKm) * 100));
  $('#weekly-goal-ring').style.setProperty('--progress', pct);
  $('#weekly-goal-percent').textContent = `${pct}%`;
  $('#weekly-goal-current').textContent = formatDistance(stats.weeklyDistance, 1);
  $('#weekly-goal-target').textContent = `/ ${formatDistance(targetKm, 1)}`;
  const remaining = Math.max(0, targetKm - stats.weeklyDistance);
  $('#weekly-goal-insight').textContent = remaining <= 0 ? 'Goal complete. Keep moving if the body feels good.' : `${formatDistance(remaining, 1)} left to hit your target.`;
}

function renderRecentActivity() {
  const host = $('#recent-activity');
  const runs = [...state.runs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  if (!runs.length) {
    host.innerHTML = emptyState('footprints', 'No runs logged yet', 'Your recent activity will appear here.', 'Log a run', 'log-run');
    return;
  }
  host.innerHTML = runs.map(run => `<button type="button" class="activity-row" data-run-id="${run.id}">${activityIcon(run.run_type)}<div class="activity-info"><strong>${escapeHTML(run.route_name || run.run_type || 'Run')}</strong><small>${formatDate(run.date, { month: 'short', day: 'numeric', year: 'numeric' })} · ${escapeHTML(run.run_type)}</small></div><div class="activity-meta"><strong>${formatDistance(run.distance_km)}</strong><small>${formatPace(getPace(run))}</small></div></button>`).join('');
}

function renderDashboardPRs(prs) {
  const selected = [prs.find(pr => pr.id === '5k'), prs.find(pr => pr.id === '10k'), prs.find(pr => pr.id === 'longest'), prs.find(pr => pr.id === 'pace')];
  $('#dashboard-prs').innerHTML = selected.map(pr => `<button type="button" class="mini-pr ${pr.run ? '' : 'empty-pr'}" ${pr.run ? `data-run-id="${pr.run.id}"` : ''}><span>${escapeHTML(pr.label)}</span><strong>${formatPRValue(pr)}</strong><small>${pr.run ? formatDate(pr.run.date, { month: 'short', day: 'numeric' }) : 'keep building'}</small></button>`).join('');
}

function renderCalendar() {
  const month = state.calendarMonth;
  $('#calendar-month-label').textContent = formatMonth(month);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const mondayOffset = first.getDay() === 0 ? 6 : first.getDay() - 1;
  const byDay = new Map();
  state.runs.forEach(run => byDay.set(run.date, (byDay.get(run.date) || 0) + run.distance_km));
  const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const cells = weekdays.map(day => `<div class="calendar-weekday">${day}</div>`);
  for (let i = 0; i < mondayOffset; i += 1) cells.push('<div class="calendar-day empty"></div>');
  for (let day = 1; day <= last.getDate(); day += 1) {
    const date = new Date(month.getFullYear(), month.getMonth(), day);
    const iso = dateToISO(date);
    const distance = byDay.get(iso) || 0;
    const today = isSameDay(date, new Date()) ? 'today' : '';
    cells.push(`<div class="calendar-day ${today}" title="${formatDate(iso)}${distance ? ` — ${formatDistance(distance)}` : ''}"><span>${day}</span>${distance ? `<span class="cal-distance">${formatDistanceValue(distance, 1)}</span><i class="cal-dot"></i>` : ''}</div>`);
  }
  $('#calendar-grid').innerHTML = cells.join('');
}

function renderHistory() {
  const stats = getStats();
  $('#history-summary').textContent = stats.totalRuns ? `${formatDistance(stats.totalDistance)} across ${plural(stats.totalRuns, 'run')}.` : 'Every mile you log will live here.';
  applyHistoryFilters();
}

function applyHistoryFilters() {
  const search = ($('#history-search')?.value || '').trim().toLowerCase();
  const type = $('#filter-run-type')?.value || 'all';
  const distance = $('#filter-distance')?.value || 'all';
  const sort = $('#history-sort')?.value || 'date-desc';
  let runs = [...state.runs];
  if (search) runs = runs.filter(run => `${run.route_name || ''} ${run.notes || ''} ${run.run_type || ''}`.toLowerCase().includes(search));
  if (type !== 'all') runs = runs.filter(run => run.run_type === type);
  if (distance !== 'all') {
    const thresholds = getDistanceUnit() === 'km'
      ? { a: 5, b: 10, c: 21.0975 }
      : { a: milesToKm(3), b: milesToKm(6.2), c: milesToKm(13.1) };
    runs = runs.filter(run => {
      if (distance === 'under3') return run.distance_km < thresholds.a;
      if (distance === '3to6') return run.distance_km >= thresholds.a && run.distance_km < thresholds.b;
      if (distance === '6to13') return run.distance_km >= thresholds.b && run.distance_km < thresholds.c;
      return run.distance_km >= thresholds.c;
    });
  }
  const sorters = {
    'date-desc': (a, b) => b.date.localeCompare(a.date) || new Date(b.created_at) - new Date(a.created_at),
    'date-asc': (a, b) => a.date.localeCompare(b.date),
    'distance-desc': (a, b) => b.distance_km - a.distance_km,
    'pace-asc': (a, b) => getPace(a) - getPace(b),
  };
  runs.sort(sorters[sort]);
  const host = $('#history-list');
  if (!runs.length) {
    host.innerHTML = emptyState('search-x', search || type !== 'all' || distance !== 'all' ? 'No matching runs' : 'No runs logged yet', 'Adjust your filters or log your next run.', search ? 'Clear search' : 'Log a run', search ? 'clear-history-search' : 'log-run');
    return;
  }
  host.innerHTML = runs.map(run => {
    const date = localDate(run.date);
    return `<button type="button" class="history-run" data-run-id="${run.id}"><span class="history-date"><b>${date.getDate()}</b><span>${date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</span></span><span class="history-main"><strong>${escapeHTML(run.route_name || `${run.run_type || 'Run'} run`)}</strong><span>${formatDuration(run.duration_seconds)} · ${escapeHTML(run.notes ? run.notes.slice(0, 58) : run.run_type || 'Run')}</span></span>${typePill(run.run_type)}<span class="history-stat"><strong>${formatDistance(run.distance_km)}</strong><span>distance</span></span><span class="history-stat"><strong>${formatPace(getPace(run))}</strong><span>average pace</span></span><i class="history-more" data-lucide="chevron-right"></i></button>`;
  }).join('');
}

function renderStatistics() {
  const stats = getStats();
  const cards = [
    ['route', 'TOTAL DISTANCE', formatDistance(stats.totalDistance)],
    ['mountain', 'TOTAL ELEVATION', formatElevation(stats.totalElevation)],
    ['timer', 'TOTAL RUNNING TIME', formatDurationShort(stats.totalTime)],
    ['move-right', 'AVERAGE RUN LENGTH', formatDistance(stats.avgRunLength)],
    ['gauge', 'AVERAGE PACE', formatPace(stats.avgPace)],
    ['zap', 'FASTEST PACE', formatPace(stats.fastestPace)],
    ['mountain-snow', 'LONGEST RUN', formatDistance(stats.longestRun)],
    ['layers-3', 'RUNS LOGGED', stats.totalRuns.toLocaleString()],
    ['calendar-days', 'THIS WEEK', formatDistance(stats.weeklyDistance)],
    ['calendar-range', 'THIS MONTH', formatDistance(stats.monthlyDistance)],
    ['calendar-heart', 'THIS YEAR', formatDistance(stats.yearlyDistance)],
    ['flame', 'CURRENT STREAK', `${stats.streak} ${stats.streak === 1 ? 'day' : 'days'}`],
  ];
  $('#statistics-cards').innerHTML = cards.map(([icon, label, value], index) => `<article class="stat-card"><span class="stat-card-icon" style="--icon-bg:${['rgba(201,255,85,.11)','rgba(125,183,255,.11)','rgba(255,200,107,.11)','rgba(255,135,95,.11)'][index % 4]};--icon-color:${['var(--lime)','var(--blue)','var(--gold)','var(--orange)'][index % 4]}"><i data-lucide="${icon}"></i></span><small>${label}</small><strong>${escapeHTML(String(value))}</strong></article>`).join('');
  renderFrequencyChart();
  renderTimeChart();
  renderFullPRGrid();
  renderHeatmap();
  renderAchievements(stats);
}

function renderFullPRGrid() {
  const host = $('#full-pr-grid');
  if (!host) return;
  host.innerHTML = getPRs().map(pr => `<button type="button" class="record-card" ${pr.run ? `data-run-id="${pr.run.id}"` : ''}><span>${escapeHTML(pr.label)}</span><strong>${formatPRValue(pr)}</strong><small>${pr.run ? `${formatDate(pr.run.date, { month: 'short', day: 'numeric', year: 'numeric' })} · ${formatPace(getPace(pr.run))}` : 'Log a qualifying run'}</small></button>`).join('');
}

function renderHeatmap() {
  const host = $('#heatmap');
  const daily = new Map();
  state.runs.forEach(run => daily.set(run.date, (daily.get(run.date) || 0) + run.distance_km));
  const cells = [];
  const start = startOfDay(new Date()); start.setDate(start.getDate() - 181);
  for (let i = 0; i < 182; i += 1) {
    const date = new Date(start); date.setDate(start.getDate() + i);
    const distance = daily.get(dateToISO(date)) || 0;
    const displayDistance = kmToDisplay(distance); const level = displayDistance >= (getDistanceUnit() === 'km' ? 24 : 15) ? 4 : displayDistance >= (getDistanceUnit() === 'km' ? 16 : 10) ? 3 : displayDistance >= (getDistanceUnit() === 'km' ? 8 : 5) ? 2 : displayDistance > 0 ? 1 : 0;
    cells.push(`<span class="heatmap-day" data-level="${level}" title="${formatDate(dateToISO(date))}: ${formatDistance(distance)}"></span>`);
  }
  host.innerHTML = cells.join('');
}
function renderAchievements(stats) {
  $('#achievement-grid').innerHTML = getAchievements().map(item => {
    const unlocked = item.unlocked(stats);
    return `<article class="achievement ${unlocked ? 'unlocked' : ''}"><span class="achievement-icon"><i data-lucide="${item.icon}"></i></span><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.copy)}</span></article>`;
  }).join('');
}

function renderProgress() {
  const rangeRuns = filterRange(state.runs, state.progressRange);
  renderWeeklyMileageChart(rangeRuns);
  renderPaceChart(rangeRuns);
  renderLongestRunsChart(rangeRuns);
  renderPRChart(rangeRuns);
}

function renderFriends() {
  const friends = state.friends;
  const requests = state.pendingRequests;
  $('#friends-count').textContent = `${friends.length} ${friends.length === 1 ? 'friend' : 'friends'}`;
  $('#requests-count').textContent = `${requests.length} pending`;
  const badge = $('#request-badge');
  badge.textContent = requests.length;
  badge.classList.toggle('hidden', !requests.length);

  const list = $('#friends-list');
  if (!friends.length) {
    list.innerHTML = emptyState('users-round', 'Your circle is ready', 'Search for a friend by name or email to get started.');
  } else {
    list.innerHTML = friends.map(friend => {
      const friendStats = friend.public_summary || null;
      return `<button type="button" class="friend-row" data-friend-id="${friend.id}">${avatarMarkup(friend)}<span class="friend-copy"><strong>${escapeHTML(friend.display_name || 'Runner')}</strong><span>${friend.settings?.share_activity === false ? 'Private activity' : 'Connected runner'}</span></span>${friendStats ? `<span class="friend-row-stats"><div><strong>${formatDistance(friendStats.weekly_distance || 0, 1)}</strong><small>this week</small></div><div><strong>${friendStats.total_runs || 0}</strong><small>runs</small></div></span>` : '<i data-lucide="chevron-right"></i>'}</button>`;
    }).join('');
  }

  const requestsList = $('#requests-list');
  if (!requests.length) requestsList.innerHTML = '<div class="center-empty"><div><strong>All caught up</strong><p>New requests will appear here.</p></div></div>';
  else {
    const requesterIds = requests.map(request => request.sender_id);
    fetchProfilesByIds(requesterIds).then(profiles => {
      const map = new Map(profiles.map(profile => [profile.id, profile]));
      requestsList.innerHTML = requests.map(request => {
        const sender = map.get(request.sender_id) || { display_name: 'Runner', id: request.sender_id };
        return `<div class="request-row">${avatarMarkup(sender)}<span class="friend-copy"><strong>${escapeHTML(sender.display_name)}</strong><span>Wants to connect</span></span><span class="request-actions"><button class="icon-btn" type="button" data-request-action="accept" data-request-id="${request.id}" aria-label="Accept"><i data-lucide="check"></i></button><button class="icon-btn" type="button" data-request-action="decline" data-request-id="${request.id}" aria-label="Decline"><i data-lucide="x"></i></button></span></div>`;
      }).join(''); initIcons();
    });
  }
}

function renderFriendProfile() {
  const friend = state.friendProfile;
  if (!friend) return;
  const friendStats = getStats(state.friendRuns);
  const friendPRs = getPRs(state.friendRuns);
  const privateActivity = friend.settings?.share_activity === false;
  const host = $('#friend-profile-content');
  host.innerHTML = `
    <div class="friend-profile-hero">
      ${avatarMarkup(friend, 'avatar-xl')}
      <div class="profile-identity"><p class="eyebrow">RUNNING TOGETHER</p><h2>${escapeHTML(friend.display_name || 'Runner')}</h2><p>${privateActivity ? 'Their activity is private.' : `Joined ${formatDate(firstValidDate(friend.joined_at, friend.created_at), { month: 'long', year: 'numeric' })}`}</p><div class="profile-facts"><span><b>${friendStats.totalRuns}</b> runs</span><span><b>${formatDistance(friendStats.totalDistance, 1)}</b> lifetime</span><span><b>${friendStats.streak}</b> day streak</span></div></div>
      <div class="profile-hero-actions"><button id="compare-btn" class="btn btn-primary" type="button"><i data-lucide="columns-2"></i>Compare</button><button id="remove-friend-btn" class="btn btn-ghost" type="button">Remove</button></div>
    </div>
    <div class="friend-stat-grid">
      ${friendStatCard('TOTAL DISTANCE', formatDistance(friendStats.totalDistance), 'route')}
      ${friendStatCard('AVERAGE PACE', formatPace(friendStats.avgPace), 'gauge')}
      ${friendStatCard('THIS WEEK', formatDistance(friendStats.weeklyDistance), 'calendar-days')}
      ${friendStatCard('LONGEST RUN', formatDistance(friendStats.longestRun), 'mountain')}
    </div>
    <div class="friend-profile-main">
      <article class="panel"><div class="panel-heading"><div><p class="eyebrow">RECENT ACTIVITY</p><h3>${privateActivity ? 'Activity is private' : 'Latest runs'}</h3></div></div><div class="profile-run-list">${privateActivity ? '<div class="center-empty"><div><strong>Private activity</strong><p>This runner has chosen not to share their runs.</p></div></div>' : renderFriendRuns(state.friendRuns)}</div></article>
      <article class="panel"><div class="panel-heading"><div><p class="eyebrow">PERSONAL RECORDS</p><h3>Records to chase</h3></div></div><div class="mini-pr-grid">${friendPRs.slice(0, 4).map(pr => `<div class="mini-pr"><span>${escapeHTML(pr.label)}</span><strong>${formatPRValue(pr)}</strong><small>${pr.run ? formatDate(pr.run.date, { month: 'short', day: 'numeric' }) : 'No record yet'}</small></div>`).join('')}</div></article>
    </div>`;
}
function friendStatCard(label, value, icon) { return `<article class="stat-card"><span class="stat-card-icon"><i data-lucide="${icon}"></i></span><small>${label}</small><strong>${escapeHTML(value)}</strong></article>`; }
function renderFriendRuns(runs) {
  if (!runs.length) return '<div class="center-empty"><div><strong>No shared runs yet</strong><p>Their public activity will appear here.</p></div></div>';
  return [...runs].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 6).map(run => `<button type="button" class="activity-row" data-run-id="${run.id}" data-friend-run="true">${activityIcon(run.run_type)}<span class="activity-info"><strong>${escapeHTML(run.route_name || run.run_type || 'Run')}</strong><small>${formatDate(run.date, { month: 'short', day: 'numeric' })} · ${escapeHTML(run.run_type || 'Run')}</small></span><span class="activity-meta"><strong>${formatDistance(run.distance_km)}</strong><small>${formatPace(getPace(run))}</small></span></button>`).join('');
}

function renderCompare() {
  const friend = state.friendProfile;
  if (!friend) return;
  const mine = getStats(state.runs);
  const theirs = getStats(state.friendRuns);
  const stats = [
    ['Total distance', mine.totalDistance, theirs.totalDistance, value => formatDistance(value)],
    ['Total runs', mine.totalRuns, theirs.totalRuns, value => value.toLocaleString()],
    ['Average pace', mine.avgPace, theirs.avgPace, value => formatPace(value), 'lower'],
    ['Weekly distance', mine.weeklyDistance, theirs.weeklyDistance, value => formatDistance(value)],
    ['Monthly distance', mine.monthlyDistance, theirs.monthlyDistance, value => formatDistance(value)],
    ['Longest run', mine.longestRun, theirs.longestRun, value => formatDistance(value)],
    ['Current streak', mine.streak, theirs.streak, value => `${value} days`],
  ];
  $('#compare-content').innerHTML = `<div class="compare-header"><p class="eyebrow">HEAD TO HEAD</p><h2>Two training stories.</h2><p>Different distance. Same commitment.</p><div class="vs-row"><div class="compare-person">${avatarMarkup(state.profile)}<span><strong>${escapeHTML(state.profile.display_name || 'You')}</strong><span>You</span></span></div><span class="vs-badge">vs</span><div class="compare-person right">${avatarMarkup(friend)}<span><strong>${escapeHTML(friend.display_name || 'Runner')}</strong><span>Friend</span></span></div></div></div><div class="compare-grid">${stats.map(([label, a, b, format, direction]) => compareStatMarkup(label, a, b, format, direction)).join('')}</div><article class="panel chart-panel compare-chart-panel"><div class="panel-heading"><div><p class="eyebrow">VOLUME MATCHUP</p><h3>Weekly distance</h3></div><span class="panel-note">Last 12 weeks</span></div><div class="chart-wrap"><canvas id="compare-chart"></canvas></div></article>`;
  renderCompareChart();
  initIcons();
}
function compareStatMarkup(label, mine, theirs, format, direction = 'higher') {
  const validMine = Number.isFinite(mine) && mine !== Infinity;
  const validTheirs = Number.isFinite(theirs) && theirs !== Infinity;
  let mineWins = false; let theirWins = false;
  if (validMine && validTheirs && mine !== theirs) {
    mineWins = direction === 'lower' ? mine < theirs : mine > theirs;
    theirWins = !mineWins;
  }
  return `<article class="compare-stat"><div class="compare-stat-label"><span>${escapeHTML(label)}</span><span>${mineWins ? 'You lead' : theirWins ? `${escapeHTML(state.friendProfile.display_name || 'Friend')} leads` : 'Even'}</span></div><div class="compare-values"><div class="compare-value ${mineWins ? 'winner' : ''}"><span>${escapeHTML(state.profile.display_name || 'You')}</span><strong>${escapeHTML(format(validMine ? mine : 0))}</strong></div><div class="compare-value ${theirWins ? 'winner' : ''}"><span>${escapeHTML(state.friendProfile.display_name || 'Friend')}</span><strong>${escapeHTML(format(validTheirs ? theirs : 0))}</strong></div></div></article>`;
}

function renderProfile() {
  const stats = getStats();
  const profile = state.profile;
  const host = $('#profile-content');
  if (!profile) return;
  host.innerHTML = `<div class="profile-hero">${avatarMarkup(profile, 'avatar-xl')}<div class="profile-identity"><p class="eyebrow">YOUR RUNNING PROFILE</p><h2>${escapeHTML(profile.display_name || 'Runner')}</h2><p>${escapeHTML(profile.email || state.user?.email || '')}</p><div class="profile-facts"><span>Member since <b>${formatDate(firstValidDate(profile.joined_at, profile.created_at, state.user?.created_at), { month: 'short', year: 'numeric' })}</b></span><span><b>${state.friends.length}</b> friends</span></div></div><div class="profile-hero-actions"><button id="edit-profile-btn" class="btn btn-soft" type="button"><i data-lucide="pencil"></i>Edit profile</button></div></div><div class="profile-dashboard-grid"><article class="panel"><div class="panel-heading"><div><p class="eyebrow">YOUR OVERVIEW</p><h3>Lifetime effort</h3></div></div><div class="profile-info-list"><div><span>Total distance</span><strong>${formatDistance(stats.totalDistance)}</strong></div><div><span>Runs logged</span><strong>${stats.totalRuns}</strong></div><div><span>Time on feet</span><strong>${formatDurationShort(stats.totalTime)}</strong></div><div><span>Current streak</span><strong>${stats.streak} days</strong></div></div></article><article class="panel"><div class="panel-heading"><div><p class="eyebrow">BEST WORK</p><h3>Personal records</h3></div></div><div class="mini-pr-grid">${getPRs().slice(0,4).map(pr => `<button class="mini-pr" ${pr.run ? `data-run-id="${pr.run.id}"` : ''}><span>${escapeHTML(pr.label)}</span><strong>${formatPRValue(pr)}</strong><small>${pr.run ? formatDate(pr.run.date, { month: 'short', day: 'numeric' }) : 'Keep building'}</small></button>`).join('')}</div></article></div>`;
}

function refreshUnitLabels() {
  const unit = getDistanceUnit();
  $$('[data-distance-unit]').forEach(el => { el.textContent = unitLabel(unit); });
  $$('[data-elevation-unit]').forEach(el => { el.textContent = elevationUnitLabel(unit); });
  $$('.unit-choice').forEach(button => button.classList.toggle('active', button.dataset.distanceUnitChoice === unit));
  const filters = $('#filter-distance');
  if (filters) {
    const labels = unit === 'km'
      ? { under3: 'Under 5 km', '3to6': '5–10 km', '6to13': '10–21.1 km', over13: 'Half marathon+' }
      : { under3: 'Under 3 mi', '3to6': '3–6.2 mi', '6to13': '6.2–13.1 mi', over13: 'Half marathon+' };
    Object.entries(labels).forEach(([value, label]) => { const option = filters.querySelector(`option[value="${value}"]`); if (option) option.textContent = label; });
  }
}
function renderSettings() {
  if (!state.profile) return;
  refreshUnitLabels();
  setDistanceInputFromCanonical($('#settings-weekly-goal'), Number(state.profile.weekly_goal_km || 30), 2);
  setDistanceInputFromCanonical($('#settings-monthly-goal'), Number(state.profile.monthly_goal_km || 120), 2);
  $('#settings-share-activity').checked = state.profile.settings?.share_activity !== false;
}

function renderDashboardChart() {
  const runs = filterRange(state.runs, state.dashboardRange);
  const series = dailySeries(runs, state.dashboardRange, 30);
  createChart('dashboard-distance-chart', {
    type: 'line',
    labels: series.labels,
    datasets: [{ label: 'Distance', data: series.values, borderColor: getCss('--lime'), backgroundColor: makeGradient('dashboard-distance-chart', 'rgba(201,255,85,.25)', 'rgba(201,255,85,0)'), fill: true, tension: .37, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 }],
    yTitle: unitLabel(),
  });
}
function renderFrequencyChart() {
  const series = groupedSeries(state.runs, 'week', 12, run => 1, 'Runs');
  createChart('frequency-chart', { type: 'bar', labels: series.labels, datasets: [{ label: 'Runs', data: series.values, backgroundColor: 'rgba(125,183,255,.58)', borderRadius: 5, maxBarThickness: 26 }], yTitle: 'runs' });
}
function renderTimeChart() {
  const series = groupedSeries(state.runs, 'month', 6, run => run.duration_seconds / 3600, 'Hours');
  createChart('time-chart', { type: 'bar', labels: series.labels, datasets: [{ label: 'Hours', data: series.values.map(v => round(v, 1)), backgroundColor: 'rgba(255,200,107,.62)', borderRadius: 5, maxBarThickness: 34 }], yTitle: 'hours' });
}
function renderWeeklyMileageChart(runs) {
  const series = groupedSeries(runs, 'week', 12, run => kmToDisplay(run.distance_km), 'Distance');
  createChart('weekly-mileage-chart', { type: 'bar', labels: series.labels, datasets: [{ label: 'Distance', data: series.values.map(v => round(v, 1)), backgroundColor: 'rgba(201,255,85,.67)', borderRadius: 5, maxBarThickness: 31 }], yTitle: unitLabel(), zoom: true });
}
function renderPaceChart(runs) {
  const sorted = [...runs].sort((a,b) => a.date.localeCompare(b.date));
  createChart('pace-chart', { type: 'line', labels: sorted.map(run => formatDate(run.date, { month: 'short', day: 'numeric' })), datasets: [{ label: 'Pace', data: sorted.map(getPace), borderColor: getCss('--orange'), backgroundColor: makeGradient('pace-chart','rgba(255,135,95,.20)','rgba(255,135,95,0)'), fill:true,tension:.36,pointRadius:2,pointHoverRadius:4,borderWidth:2 }], yTitle: 'pace', paceAxis: true, zoom: true });
}
function renderLongestRunsChart(runs) {
  const sorted = [...runs].sort((a,b) => a.date.localeCompare(b.date));
  createChart('longest-runs-chart', { type: 'line', labels: sorted.map(run => formatDate(run.date, { month: 'short', day: 'numeric' })), datasets: [{ label: 'Distance', data: sorted.map(run => kmToDisplay(run.distance_km)), borderColor: getCss('--blue'), backgroundColor: makeGradient('longest-runs-chart','rgba(125,183,255,.22)','rgba(125,183,255,0)'), fill:true,tension:.3,pointRadius:2,pointHoverRadius:4,borderWidth:2 }], yTitle:unitLabel(),zoom:true });
}
function renderPRChart(runs) {
  const sorted = [...runs].sort((a,b) => a.date.localeCompare(b.date)).filter(run => run.distance_km >= 5);
  let best = Infinity;
  const values = sorted.map(run => { best = Math.min(best, getPace(run)); return best; });
  createChart('pr-chart', { type: 'line', labels: sorted.map(run => formatDate(run.date, { month: 'short', day: 'numeric' })), datasets: [{ label: 'Best 5K-equivalent pace', data: values, borderColor: getCss('--gold'), backgroundColor: makeGradient('pr-chart','rgba(255,200,107,.21)','rgba(255,200,107,0)'), fill:true,tension:.28,pointRadius:2,pointHoverRadius:4,borderWidth:2 }], yTitle:'pace',paceAxis:true,zoom:true });
}
function renderCompareChart() {
  if (!state.friendProfile) return;
  const mine = groupedSeries(state.runs, 'week', 12, run => kmToDisplay(run.distance_km), 'Distance');
  const theirValues = valuesForSeries(state.friendRuns, mine.keys, 'week', run => kmToDisplay(run.distance_km));
  createChart('compare-chart', { type: 'line', labels: mine.labels, datasets: [
    { label: state.profile.display_name || 'You', data: mine.values, borderColor: getCss('--lime'), backgroundColor:'rgba(201,255,85,.08)', fill:true,tension:.35,pointRadius:2,borderWidth:2 },
    { label: state.friendProfile.display_name || 'Friend', data: theirValues, borderColor: getCss('--orange'), backgroundColor:'rgba(255,135,95,.03)', fill:true,tension:.35,pointRadius:2,borderWidth:2 },
  ], yTitle:unitLabel(), showLegend:true });
}

function dailySeries(runs, range, defaultDays = 30) {
  const start = rangeStart(range) || (runs.length ? localDate([...runs].sort((a,b) => a.date.localeCompare(b.date))[0].date) : (() => { const d = new Date(); d.setDate(d.getDate() - defaultDays + 1); return d; })());
  const points = new Map();
  runs.forEach(run => points.set(run.date, (points.get(run.date) || 0) + run.distance_km));
  const labels = []; const values = [];
  const cursor = startOfDay(start); const end = startOfDay(new Date());
  while (cursor <= end) {
    const iso = dateToISO(cursor); labels.push(cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })); values.push(round(kmToDisplay(points.get(iso) || 0), 2)); cursor.setDate(cursor.getDate() + 1);
  }
  return { labels, values };
}
function groupedSeries(runs, unit, count, getter) {
  const now = new Date(); const keys = []; const labels = [];
  if (unit === 'week') {
    const current = startOfWeek(now);
    for (let i = count - 1; i >= 0; i -= 1) { const d = new Date(current); d.setDate(d.getDate() - i * 7); keys.push(dateToISO(d)); labels.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })); }
  } else {
    const current = startOfMonth(now);
    for (let i = count - 1; i >= 0; i -= 1) { const d = new Date(current.getFullYear(), current.getMonth() - i, 1); keys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`); labels.push(d.toLocaleDateString(undefined, { month: 'short' })); }
  }
  return { keys, labels, values: valuesForSeries(runs, keys, unit, getter) };
}
function valuesForSeries(runs, keys, unit, getter) {
  const map = new Map(keys.map(key => [key, 0]));
  runs.forEach(run => {
    const date = localDate(run.date);
    const key = unit === 'week' ? dateToISO(startOfWeek(date)) : `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
    if (map.has(key)) map.set(key, map.get(key) + Number(getter(run) || 0));
  });
  return keys.map(key => round(map.get(key), 2));
}
function makeGradient(canvasId, top, bottom) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return top;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 260);
  gradient.addColorStop(0, top); gradient.addColorStop(1, bottom);
  return gradient;
}
function createChart(canvasId, { type, labels, datasets, yTitle = '', paceAxis = false, zoom = false, showLegend = false }) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) return;
  if (state.charts[canvasId]) state.charts[canvasId].destroy();
  const grid = getCss('--border');
  const text = getCss('--subtle');
  const chartDataEmpty = datasets.every(dataset => !dataset.data?.length || dataset.data.every(value => !value));
  if (chartDataEmpty) { labels = ['No data']; datasets = datasets.map(dataset => ({ ...dataset, data: [0] })); }
  state.charts[canvasId] = new Chart(canvas, {
    type,
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: showLegend, labels: { color: text, usePointStyle: true, boxWidth: 6, font: { size: 10 } } },
        tooltip: {
          backgroundColor: getCss('--surface-solid'), borderColor: getCss('--border-strong'), borderWidth: 1, padding: 10, cornerRadius: 9,
          callbacks: { label(context) { const value = context.parsed.y; if (paceAxis) return `${context.dataset.label}: ${formatPace(value)}`; return `${context.dataset.label}: ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${yTitle}`; } },
        },
        zoom: zoom ? { pan: { enabled: true, mode: 'x', modifierKey: null }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }, limits: { x: { min: 0, max: 'original' } } } : undefined,
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: text, maxTicksLimit: 7, maxRotation: 0 }, border: { display: false } },
        y: { beginAtZero: !paceAxis, grid: { color: grid }, ticks: { color: text, callback: value => paceAxis ? formatPaceValue(value) : `${value}${yTitle ? ` ${yTitle}` : ''}` }, border: { display: false } },
      },
    },
  });
}
function destroyAllCharts() { Object.values(state.charts).forEach(chart => chart?.destroy()); state.charts = {}; }

function emptyState(icon, title, copy, actionText = '', actionView = '') {
  return `<div class="center-empty"><div><i data-lucide="${icon}"></i><strong>${escapeHTML(title)}</strong><p>${escapeHTML(copy)}</p>${actionText ? `<button class="btn btn-soft" type="button" data-view="${actionView}">${escapeHTML(actionText)}</button>` : ''}</div></div>`;
}

function navigateTo(view, updateHash = true) {
  const available = ['dashboard','log-run','live-run','history','statistics','progress','friends','friend-profile','compare','profile','settings'];
  if (!available.includes(view)) view = 'dashboard';
  state.activeView = view;
  $$('.view').forEach(el => el.classList.toggle('active-view', el.id === `view-${view}`));
  $$('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.view === view));
  const page = {
    dashboard: ['OVERVIEW', ''], 'log-run': ['NEW ACTIVITY','Log a run'], 'live-run': ['LIVE ACTIVITY','Live run'], history: ['YOUR ARCHIVE','Run history'], statistics: ['THE DETAILS','Statistics'], progress: ['THE LONG VIEW','Progress'], friends: ['YOUR RUNNING CIRCLE','Friends'], 'friend-profile': ['RUNNING TOGETHER','Friend profile'], compare: ['HEAD TO HEAD','Compare'], profile: ['YOUR RUNNING PROFILE','My profile'], settings: ['YOUR PREFERENCES','Settings'],
  }[view];
  $('#page-kicker').textContent = page[0];
  if (view !== 'dashboard') $('#page-title').textContent = page[1]; else renderTopbar();
  if (updateHash) history.replaceState(null, '', `#${view}`);
  $('#sidebar').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'friend-profile') renderFriendProfile();
  if (view === 'compare') renderCompare();
}

async function handleAuthSubmit(event, mode) {
  event.preventDefault();
  if (!isConfigured) return;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  setAuthMessage('');
  try {
    if (mode === 'signin') {
      const email = $('#sign-in-email').value.trim(); const password = $('#sign-in-password').value;
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.user) await enterApp(data.user);
    } else {
      const displayName = $('#register-name').value.trim(); const email = $('#register-email').value.trim(); const password = $('#register-password').value;
      if (displayName.length < 2) throw new Error('Please enter a display name with at least 2 characters.');
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName, full_name: displayName } } });
      if (error) throw error;
      if (data.session?.user) {
        await supabase.from('profiles').upsert({ id: data.user.id, display_name: displayName, email, joined_at: new Date().toISOString() });
        await enterApp(data.user);
      } else {
        setAuthMessage('Account created. Check your email to confirm your address, then sign in.', false);
        $('#register-form').reset();
      }
    }
  } catch (error) {
    setAuthMessage(error.message || 'Something went wrong. Please try again.');
  } finally { button.disabled = false; }
}

async function handleRunSubmit(event) {
  event.preventDefault();
  const distance = Number($('#run-distance').value);
  const hours = Math.max(0, Number($('#run-hours').value || 0)); const minutes = Math.max(0, Number($('#run-minutes').value || 0)); const seconds = Math.max(0, Number($('#run-seconds').value || 0));
  const duration_seconds = Math.round(hours * 3600 + minutes * 60 + seconds);
  if (!(distance > 0)) return showToast('Enter a valid distance', 'Distance must be greater than zero.', 'error');
  if (!(duration_seconds > 0)) return showToast('Enter a valid time', 'Time must be greater than zero.', 'error');
  const payload = {
    user_id: state.user.id,
    date: $('#run-date').value || todayISO(),
    distance_km: distanceInputToCanonical($('#run-distance')),
    duration_seconds,
    run_type: $('#run-type').value,
    route_name: $('#run-route').value.trim() || null,
    notes: $('#run-notes').value.trim() || null,
    elevation_m: elevationInputToCanonical($('#run-elevation')),
    calories: Math.max(0, Number($('#run-calories').value || 0)),
    visibility: $('#run-visibility').value === 'private' ? 'private' : 'friends',
  };
  const before = getPRs();
  const submit = $('#run-form button[type="submit"]'); submit.disabled = true;
  try {
    let error;
    if (state.editingRunId) ({ error } = await supabase.from('runs').update(payload).eq('id', state.editingRunId).eq('user_id', state.user.id));
    else ({ error } = await supabase.from('runs').insert(payload));
    if (error) throw error;
    state.editingRunId = null; resetRunForm(); await refreshAppData({ silent: true });
    const after = getPRs(); const newRecords = after.filter(pr => pr.run && !before.find(old => old.id === pr.id && old.run?.id === pr.run.id));
    showToast(newRecords.length ? 'New personal record!' : 'Run saved', newRecords.length ? newRecords.map(pr => pr.label).slice(0, 2).join(' · ') : 'Your stats, progress, and goals are up to date.');
  } catch (error) { showToast('Could not save run', error.message, 'error'); }
  finally { submit.disabled = false; }
}
function resetRunForm() {
  $('#run-form').reset(); delete $('#run-distance').dataset.canonicalKm; delete $('#run-distance').dataset.renderedValue; delete $('#run-elevation').dataset.canonicalM; delete $('#run-elevation').dataset.renderedValue; $('#run-date').value = todayISO(); $('#run-hours').value = 0;
  $('#run-form button[type="submit"]').innerHTML = '<i data-lucide="check"></i>Save run';
  updateRunPreview(); initIcons();
}
function editRun(run) {
  state.editingRunId = run.id;
  setDistanceInputFromCanonical($('#run-distance'), run.distance_km, 3);
  const h = Math.floor(run.duration_seconds / 3600); const m = Math.floor((run.duration_seconds % 3600) / 60); const s = run.duration_seconds % 60;
  $('#run-hours').value = h; $('#run-minutes').value = m; $('#run-seconds').value = s; $('#run-date').value = run.date; $('#run-type').value = run.run_type || 'Easy'; $('#run-route').value = run.route_name || ''; $('#run-notes').value = run.notes || ''; if (run.elevation_m) setElevationInputFromCanonical($('#run-elevation'), run.elevation_m); else { $('#run-elevation').value = ''; delete $('#run-elevation').dataset.canonicalM; delete $('#run-elevation').dataset.renderedValue; } $('#run-calories').value = run.calories || ''; $('#run-visibility').value = run.visibility || 'friends';
  $('#run-form button[type="submit"]').innerHTML = '<i data-lucide="save"></i>Update run'; navigateTo('log-run'); updateRunPreview(); initIcons();
}
function updateRunPreview() {
  const distance = Number($('#run-distance')?.value || 0);
  const hours = Number($('#run-hours')?.value || 0), minutes = Number($('#run-minutes')?.value || 0), seconds = Number($('#run-seconds')?.value || 0); const duration = hours * 3600 + minutes * 60 + seconds;
  $('#live-pace').textContent = distance && duration ? formatPace(duration / distance) : '—';
  $('#preview-distance').innerHTML = `${distance.toFixed(2)} <small>${unitLabel()}</small>`;
  $('#preview-time').textContent = formatDuration(duration);
  $('#preview-pace').textContent = distance && duration ? formatPace(duration / distance) : '—';
  $('#preview-type').textContent = $('#run-type')?.value || 'Easy';
  const potential = previewPotentialPR(distance, duration);
  $('#potential-pr-title').textContent = potential.title; $('#potential-pr-copy').textContent = potential.copy;
}
function previewPotentialPR(distance, duration) {
  if (!distance || !duration) return { title: 'A new page, every run.', copy: 'Your personal records will surface here as you build your history.' };
  const pace = duration / distance; const prs = getPRs(); const checks = getDistanceUnit() === 'km'
    ? [{ id: '1k', target: 1, label: 'A 1K personal record.' }, { id: '5k', target: 5, label: 'A 5K personal record.' }, { id: '10k', target: 10, label: 'A 10K personal record.' }, { id: 'half', target: 21.0975, label: 'A half marathon record.' }]
    : [{ id: 'mile', target: 1, label: 'A one-mile personal record.' }, { id: '5k', target: kmToMiles(5), label: 'A 5K personal record.' }, { id: '10k', target: kmToMiles(10), label: 'A 10K personal record.' }, { id: 'half', target: kmToMiles(21.0975), label: 'A half marathon record.' }];
  const potential = checks.find(check => distance >= check.target && (!prs.find(pr => pr.id === check.id)?.run || pace < getPace(prs.find(pr => pr.id === check.id).run)));
  return potential ? { title: potential.label, copy: `At ${formatPace(pace)}, this would become your best qualifying effort.` } : { title: 'Effort captured, progress kept.', copy: `A ${formatPace(pace)} average adds more signal to your training story.` };
}

function openRunModal(run, { isFriendRun = false } = {}) {
  if (!run) return;
  const host = $('#run-modal-content');
  const type = run.run_type || 'Run';
  host.innerHTML = `<div class="run-modal-header">${activityIcon(type)}<div><p class="eyebrow">${escapeHTML(type).toUpperCase()}</p><h3 id="run-modal-title">${escapeHTML(run.route_name || `${type} run`)}</h3><p style="margin:4px 0 0;color:var(--muted);font-size:11px;">${formatDate(run.date)}</p></div><div class="run-modal-distance"><strong>${formatDistance(run.distance_km)}</strong><span>${formatPace(getPace(run))}</span></div></div><div class="run-modal-details"><div class="run-modal-detail"><small>TIME</small><strong>${formatDuration(run.duration_seconds)}</strong></div><div class="run-modal-detail"><small>ELEVATION</small><strong>${formatElevation(run.elevation_m || 0)}</strong></div><div class="run-modal-detail"><small>CALORIES</small><strong>${Math.round(run.calories || 0)} kcal</strong></div></div>${run.notes ? `<div class="run-modal-note">${escapeHTML(run.notes).replace(/\n/g, '<br>')}</div>` : ''}${!isFriendRun ? `<div class="run-modal-actions"><button id="modal-delete-run" class="btn btn-danger" type="button"><i data-lucide="trash-2"></i>Delete</button><button id="modal-edit-run" class="btn btn-primary" type="button"><i data-lucide="pencil"></i>Edit run</button></div>` : ''}`;
  $('#run-modal').classList.remove('hidden'); initIcons();
  if (!isFriendRun) {
    $('#modal-edit-run').onclick = () => { closeModal('run-modal'); editRun(run); };
    $('#modal-delete-run').onclick = () => confirmDeleteRun(run);
  }
}
function closeModal(id) { $(`#${id}`).classList.add('hidden'); }
function showConfirm({ title, message, confirmText = 'Confirm', variant = 'danger', action }) {
  $('#confirm-modal-title').textContent = title; $('#confirm-message').textContent = message; $('#confirm-action').textContent = confirmText; $('#confirm-action').className = `btn ${variant === 'danger' ? 'btn-danger' : 'btn-primary'}`; state.confirmAction = action; $('#confirm-modal').classList.remove('hidden');
}
function confirmDeleteRun(run) {
  closeModal('run-modal');
  showConfirm({ title: 'Delete this run?', message: 'This will remove it from your history, statistics, goals, and records permanently.', confirmText: 'Delete run', action: async () => {
    try { const { error } = await supabase.from('runs').delete().eq('id', run.id).eq('user_id', state.user.id); if (error) throw error; await refreshAppData({ silent: true }); showToast('Run deleted', 'Your statistics were recalculated.'); }
    catch (error) { showToast('Could not delete run', error.message, 'error'); }
  }});
}

async function searchFriends() {
  const query = $('#friend-search').value.trim();
  const host = $('#friend-search-results');
  if (query.length < 2) { host.innerHTML = '<p style="margin:8px 0 0;color:var(--subtle);font-size:10px;">Type at least 2 characters to search runners.</p>'; return; }
  host.innerHTML = '<div class="loading-line"></div>';
  try {
    const safe = query.replace(/[,%()]/g, '');
    const { data, error } = await supabase.rpc('search_paceforge_profiles', { search_term: safe });
    if (error) throw error;
    if (!data?.length) { host.innerHTML = '<p style="margin:8px 0 0;color:var(--subtle);font-size:10px;">No runners found. Try a different name or email.</p>'; return; }
    host.innerHTML = data.map(profile => {
      const rel = state.relationships.find(item => (item.sender_id === profile.id && item.receiver_id === state.user.id) || (item.receiver_id === profile.id && item.sender_id === state.user.id));
      let control = `<button class="btn btn-primary" type="button" data-send-request="${profile.id}">Add</button>`;
      if (rel?.status === 'accepted') control = '<span class="panel-note">Already friends</span>';
      if (rel?.status === 'pending' && rel.sender_id === state.user.id) control = '<span class="panel-note">Request sent</span>';
      if (rel?.status === 'pending' && rel.receiver_id === state.user.id) control = `<button class="btn btn-soft" type="button" data-request-action="accept" data-request-id="${rel.id}">Accept</button>`;
      return `<div class="search-result">${avatarMarkup(profile)}<span class="friend-copy"><strong>${escapeHTML(profile.display_name || 'Runner')}</strong><span>Runner on FytRun</span></span>${control}</div>`;
    }).join(''); initIcons();
  } catch (error) { host.innerHTML = `<p style="margin:8px 0 0;color:var(--danger);font-size:10px;">${escapeHTML(error.message)}</p>`; }
}
async function sendFriendRequest(receiverId) {
  try {
    const { error } = await supabase.from('friend_requests').insert({ sender_id: state.user.id, receiver_id: receiverId, status: 'pending' });
    if (error) throw error;
    await refreshAppData({ silent: true }); await searchFriends(); showToast('Request sent', 'They can accept it from their Friends page.');
  } catch (error) { showToast('Could not send request', error.message, 'error'); }
}
async function respondFriendRequest(requestId, status) {
  try {
    const response = status === 'accepted'
      ? await supabase.from('friend_requests').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', requestId).eq('receiver_id', state.user.id)
      : await supabase.from('friend_requests').delete().eq('id', requestId).eq('receiver_id', state.user.id);
    if (response.error) throw response.error;
    await refreshAppData({ silent: true }); showToast(status === 'accepted' ? 'Friend added' : 'Request declined', status === 'accepted' ? 'You can now view each other’s shared activity.' : 'The request was declined.');
  } catch (error) { showToast('Could not update request', error.message, 'error'); }
}
async function fetchProfilesByIds(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase.rpc('paceforge_profiles_by_ids', { profile_ids: ids });
  if (error) throw error;
  return (data || []).map(profile => ({ ...profile, settings: profile.settings || {} }));
}
async function openFriendProfile(friendId) {
  try {
    const profiles = await fetchProfilesByIds([friendId]);
    const profile = profiles[0];
    if (!profile) throw new Error('This profile is no longer available to you.');
    const { data: runs, error: runsError } = await supabase.from('runs').select('*').eq('user_id', friendId).order('date', { ascending: false });
    if (runsError) throw runsError;
    state.viewingFriend = friendId; state.friendProfile = { ...profile, settings: profile.settings || {} }; state.friendRuns = (runs || []).map(normalizeRun);
    navigateTo('friend-profile');
  } catch (error) { showToast('Could not load friend profile', error.message, 'error'); }
}
async function removeFriend() {
  const relation = state.relationships.find(rel => rel.status === 'accepted' && (rel.sender_id === state.viewingFriend || rel.receiver_id === state.viewingFriend));
  if (!relation) return;
  showConfirm({ title: `Remove ${state.friendProfile.display_name}?`, message: 'You will no longer see each other’s shared training activity.', confirmText: 'Remove friend', action: async () => {
    try { const { error } = await supabase.from('friend_requests').delete().eq('id', relation.id); if (error) throw error; state.friendProfile = null; state.friendRuns = []; state.viewingFriend = null; await refreshAppData({ silent: true }); navigateTo('friends'); showToast('Friend removed', 'Your running circle has been updated.'); }
    catch (error) { showToast('Could not remove friend', error.message, 'error'); }
  }});
}

async function saveGoals(event) {
  event.preventDefault();
  const weekly_goal_km = distanceInputToCanonical($('#settings-weekly-goal'));
  const monthly_goal_km = distanceInputToCanonical($('#settings-monthly-goal'));
  if (!(weekly_goal_km > 0) || !(monthly_goal_km > 0)) return showToast('Enter valid goals', 'Both weekly and monthly targets must be greater than zero.', 'error');
  try { const { data, error } = await supabase.from('profiles').update({ weekly_goal_km, monthly_goal_km }).eq('id', state.user.id).select().single(); if (error) throw error; state.profile = { ...data, settings: data.settings || {} }; renderAll(); showToast('Goals saved', 'Your dashboard ring now reflects the new target.'); }
  catch (error) { showToast('Could not save goals', error.message, 'error'); }
}
function canonicalDistanceFromInput(input, fallback = 0) {
  if (!input || String(input.value || '').trim() === '') return fallback;
  const value = distanceInputToCanonical(input);
  return value > 0 ? value : fallback;
}
function canonicalElevationFromInput(input, fallback = 0) {
  if (!input || String(input.value || '').trim() === '') return fallback;
  const value = elevationInputToCanonical(input);
  return value > 0 ? value : fallback;
}
function captureUnitSensitiveDraft() {
  const runDistanceInput = $('#run-distance');
  const runElevationInput = $('#run-elevation');
  const liveDistanceInput = $('#live-run-distance');
  return {
    runDistanceKm: canonicalDistanceFromInput(runDistanceInput),
    runElevationM: canonicalElevationFromInput(runElevationInput),
    liveDistanceKm: canonicalDistanceFromInput(liveDistanceInput, state.liveRun.distanceKm || 0),
  };
}
function restoreUnitSensitiveDraft(draft) {
  if (draft.runDistanceKm > 0) setDistanceInputFromCanonical($('#run-distance'), draft.runDistanceKm, 3);
  if (draft.runElevationM > 0) setElevationInputFromCanonical($('#run-elevation'), draft.runElevationM);
  state.liveRun.distanceKm = draft.liveDistanceKm;
  if ($('#live-run-distance')) {
    if (draft.liveDistanceKm > 0) setDistanceInputFromCanonical($('#live-run-distance'), draft.liveDistanceKm, 3);
    else { $('#live-run-distance').value = ''; delete $('#live-run-distance').dataset.canonicalKm; delete $('#live-run-distance').dataset.renderedValue; }
  }
  updateRunPreview(); renderLiveRun();
}
async function setDistanceUnit(unit) {
  if (!['mi', 'km'].includes(unit) || unit === getDistanceUnit()) return;
  const draft = captureUnitSensitiveDraft();
  const settings = { ...(state.profile.settings || {}), distance_unit: unit };
  try {
    const { data, error } = await supabase.from('profiles').update({ settings }).eq('id', state.user.id).select().single();
    if (error) throw error;
    state.profile = { ...data, settings: data.settings || {} };
    renderAll(); restoreUnitSensitiveDraft(draft);
    showToast(`Units set to ${unit === 'km' ? 'kilometers' : 'miles'}`, 'Your existing runs and goals were converted for display only.');
  } catch (error) { showToast('Could not change units', error.message, 'error'); }
}
async function savePrivacy(event) {
  event.preventDefault();
  const settings = { ...(state.profile.settings || {}), share_activity: $('#settings-share-activity').checked };
  try { const { data, error } = await supabase.from('profiles').update({ settings }).eq('id', state.user.id).select().single(); if (error) throw error; state.profile = { ...data, settings: data.settings || {} }; renderAll(); showToast('Privacy saved', settings.share_activity ? 'Friends can see shared activity.' : 'Your activity is now private.'); }
  catch (error) { showToast('Could not save privacy', error.message, 'error'); }
}

function openProfileModal() {
  state.profilePhotoFile = null;
  $('#profile-display-name').value = state.profile.display_name || ''; $('#profile-email').value = state.profile.email || state.user.email || ''; $('#profile-edit-avatar').outerHTML = avatarMarkup(state.profile, 'avatar avatar-xl');
  $('#profile-modal').classList.remove('hidden'); initIcons();
}
async function previewProfilePhoto(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { showToast('Unsupported image', 'Use a PNG, JPG, or WebP image.', 'error'); return; }
  if (file.size > 4 * 1024 * 1024) { showToast('Image is too large', 'Choose a file under 4 MB.', 'error'); return; }
  state.profilePhotoFile = file;
  const url = URL.createObjectURL(file); $('#profile-edit-avatar').outerHTML = `<span id="profile-edit-avatar" class="avatar avatar-xl"><img src="${url}" alt="Preview" /></span>`;
}
async function saveProfile(event) {
  event.preventDefault();
  const display_name = $('#profile-display-name').value.trim(); const email = $('#profile-email').value.trim();
  if (display_name.length < 2) return showToast('Enter a display name', 'Use at least 2 characters.', 'error');
  const submit = $('#profile-form button[type="submit"]'); submit.disabled = true;
  try {
    let avatar_url = state.profile.avatar_url || null;
    if (state.profilePhotoFile) {
      const ext = state.profilePhotoFile.name.split('.').pop().toLowerCase(); const path = `${state.user.id}/avatar-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, state.profilePhotoFile, { upsert: true, contentType: state.profilePhotoFile.type, cacheControl: '3600' });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path); avatar_url = data.publicUrl;
    }
    const { data, error } = await supabase.from('profiles').update({ display_name, email, avatar_url }).eq('id', state.user.id).select().single();
    if (error) throw error;
    if (email !== state.user.email) {
      const { error: emailError } = await supabase.auth.updateUser({ email });
      if (emailError) throw emailError;
      showToast('Profile saved', 'Confirm the email-change message sent to your inbox.');
    } else showToast('Profile saved', 'Your FytRun profile is up to date.');
    state.profile = { ...data, settings: data.settings || {} }; closeModal('profile-modal'); renderAll();
  } catch (error) { showToast('Could not save profile', error.message, 'error'); }
  finally { submit.disabled = false; }
}
async function savePassword(event) {
  event.preventDefault(); const password = $('#new-password').value; if (password.length < 8) return showToast('Password is too short', 'Use at least 8 characters.', 'error');
  try { const { error } = await supabase.auth.updateUser({ password }); if (error) throw error; closeModal('password-modal'); $('#password-form').reset(); showToast('Password updated', 'Your new password is active.'); }
  catch (error) { showToast('Could not update password', error.message, 'error'); }
}
async function deleteAccount() {
  showConfirm({ title: 'Delete your account?', message: 'Your profile, runs, friendships, and uploaded avatar will be permanently deleted. This cannot be undone.', confirmText: 'Delete forever', action: async () => {
    try {
      const { error } = await supabase.functions.invoke('delete-account');
      if (error) throw error;
      await supabase.auth.signOut(); showToast('Account deleted', 'Your FytRun data has been removed.');
    } catch (error) { showToast('Could not delete account', 'Deploy the included delete-account Edge Function, then try again. ' + (error.message || ''), 'error'); }
  }});
}

function exportCSV() {
  if (!state.runs.length) return showToast('Nothing to export', 'Log a run first, then your CSV will be ready.', 'error');
  const headers = ['date','distance_km','distance_miles','duration_seconds','pace_per_km','pace_per_mile','run_type','route_name','elevation_m','elevation_ft','calories','visibility','notes'];
  const rows = state.runs.map(run => [
    run.date,
    round(run.distance_km, 6),
    round(kmToMiles(run.distance_km), 6),
    run.duration_seconds,
    round(getPace(run, 'km'), 3),
    round(getPace(run, 'mi'), 3),
    run.run_type || '', run.route_name || '',
    round(run.elevation_m || 0, 3),
    round(metersToDisplay(run.elevation_m || 0, 'mi'), 3),
    run.calories || 0, run.visibility || 'friends', run.notes || '',
  ]);
  const csv = [headers, ...rows].map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadFile(csv, `fytrun-runs-${todayISO()}.csv`, 'text/csv;charset=utf-8'); showToast('Export ready', `${state.runs.length} runs exported with both km and miles columns.`);
}
function downloadFile(content, filename, type) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
function parseNumeric(value) { const parsed = Number(String(value ?? '').trim()); return Number.isFinite(parsed) ? parsed : 0; }
function normalizeImportedUnit(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['km','kilometer','kilometers','kilometre','kilometres'].includes(raw)) return 'km';
  if (['mi','mile','miles'].includes(raw)) return 'mi';
  return null;
}
async function importCSV(file) {
  if (!file) return;
  try {
    const text = await file.text(); const rows = parseCSV(text); if (!rows.length) throw new Error('The CSV does not contain any data rows.');
    const payloads = rows.map((row, index) => {
      const canonicalKm = parseNumeric(row.distance_km);
      const miles = parseNumeric(row.distance_miles || row.distance_mi || row.miles);
      const genericDistance = parseNumeric(row.distance);
      const genericUnit = normalizeImportedUnit(row.distance_unit || row.unit) || getDistanceUnit();
      const distanceKm = canonicalKm > 0 ? canonicalKm : miles > 0 ? milesToKm(miles) : genericDistance > 0 ? displayToKm(genericDistance, genericUnit) : 0;
      const duration = parseNumeric(row.duration_seconds || row.duration);
      const elevationM = parseNumeric(row.elevation_m) > 0 ? parseNumeric(row.elevation_m) : displayToMeters(parseNumeric(row.elevation_ft), 'mi');
      const date = row.date || todayISO();
      if (!distanceKm || !duration || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Row ${index + 2} needs date (YYYY-MM-DD), a distance column (distance_km or distance_miles), and duration_seconds.`);
      return { user_id: state.user.id, date, distance_km: round(distanceKm, 6), duration_seconds: Math.round(duration), run_type: row.run_type || 'Other', route_name: row.route_name || null, notes: row.notes || null, elevation_m: round(Math.max(0, elevationM), 3), calories: Math.max(0, parseNumeric(row.calories)), visibility: row.visibility === 'private' ? 'private' : 'friends' };
    });
    if (payloads.length > 500) throw new Error('Import up to 500 rows at a time.');
    const { error } = await supabase.from('runs').insert(payloads); if (error) throw error;
    await refreshAppData({ silent: true }); showToast('Runs imported', `${payloads.length} runs were added to your history.`);
  } catch (error) { showToast('Could not import CSV', error.message, 'error'); }
  finally { $('#import-csv-input').value = ''; }
}

function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const parseLine = line => { const values = []; let current = ''; let inQuotes = false; for (let i = 0; i < line.length; i += 1) { const char = line[i]; const next = line[i+1]; if (char === '"' && inQuotes && next === '"') { current += '"'; i += 1; } else if (char === '"') inQuotes = !inQuotes; else if (char === ',' && !inQuotes) { values.push(current); current = ''; } else current += char; } values.push(current); return values.map(v => v.trim()); };
  const headers = parseLine(lines[0]).map(header => header.toLowerCase().trim());
  return lines.slice(1).map(line => { const values = parseLine(line); return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])); });
}


const LIVE_RUN_STORAGE_KEY = 'fytrun-live-run-v1';
let liveRunTick = null;
function liveRunElapsedMs() {
  return Math.max(0, Number(state.liveRun.elapsedMs || 0) + (state.liveRun.running && state.liveRun.startedAtMs ? Date.now() - state.liveRun.startedAtMs : 0));
}
function persistLiveRunState() {
  const payload = { ...state.liveRun, savedAt: Date.now() };
  try { localStorage.setItem(LIVE_RUN_STORAGE_KEY, JSON.stringify(payload)); } catch (_) { /* non-critical browser storage failure */ }
}
function restoreLiveRunState() {
  try {
    const saved = JSON.parse(localStorage.getItem(LIVE_RUN_STORAGE_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return;
    state.liveRun = {
      running: Boolean(saved.running),
      startedAtMs: Number(saved.startedAtMs) || null,
      elapsedMs: Math.max(0, Number(saved.elapsedMs) || 0),
      distanceKm: Math.max(0, Number(saved.distanceKm) || 0),
      type: TYPE_STYLES[saved.type] ? saved.type : 'Easy',
      routeName: String(saved.routeName || '').slice(0, 80),
    };
    if (state.liveRun.running && !state.liveRun.startedAtMs) state.liveRun.running = false;
  } catch (_) { /* start fresh if browser storage is malformed */ }
}
function liveRunStatus() {
  if (state.liveRun.running) return { label: 'RUNNING NOW', copy: 'Your elapsed time is advancing from the real clock.', state: 'Running', button: 'Pause run', icon: 'pause' };
  if (liveRunElapsedMs() > 0) return { label: 'PAUSED', copy: 'Your time is held. Resume when you are ready.', state: 'Paused', button: 'Resume run', icon: 'play' };
  return { label: 'READY WHEN YOU ARE', copy: 'Press start when you move. Add distance whenever you know it.', state: 'Ready', button: 'Start run', icon: 'play' };
}
function renderLiveRun() {
  const elapsedSeconds = Math.floor(liveRunElapsedMs() / 1000);
  const status = liveRunStatus();
  const distanceKm = Math.max(0, Number(state.liveRun.distanceKm || 0));
  const distance = kmToDisplay(distanceKm);
  const liveDistanceInput = $('#live-run-distance');
  if (!liveDistanceInput) return;
  if (document.activeElement !== liveDistanceInput) {
    if (distanceKm > 0) setDistanceInputFromCanonical(liveDistanceInput, distanceKm, 3);
    else { liveDistanceInput.value = ''; delete liveDistanceInput.dataset.canonicalKm; delete liveDistanceInput.dataset.renderedValue; }
  }
  $('#live-run-type').value = state.liveRun.type || 'Easy';
  if (document.activeElement !== $('#live-run-route')) $('#live-run-route').value = state.liveRun.routeName || '';
  $('#live-run-elapsed').textContent = formatDuration(elapsedSeconds);
  $('#live-run-status').textContent = status.label;
  $('#live-run-copy').textContent = status.copy;
  $('#live-run-state-label').textContent = status.state;
  $('#live-run-pace').textContent = distance > 0 && elapsedSeconds > 0 ? formatPace(elapsedSeconds / distance) : '—';
  const dot = $('#live-run-status-dot'); dot.classList.toggle('running', state.liveRun.running); dot.classList.toggle('paused', !state.liveRun.running && elapsedSeconds > 0);
  const startButton = $('#live-run-start-pause');
  startButton.innerHTML = `<i data-lucide="${status.icon}"></i><span>${status.button}</span>`;
  $('#live-run-finish').disabled = elapsedSeconds < 1;
  if (state.liveRun.running && !liveRunTick) liveRunTick = window.setInterval(renderLiveRun, 250);
  if (!state.liveRun.running && liveRunTick) { window.clearInterval(liveRunTick); liveRunTick = null; }
  initIcons();
}
function toggleLiveRun() {
  if (state.liveRun.running) {
    state.liveRun.elapsedMs = liveRunElapsedMs(); state.liveRun.startedAtMs = null; state.liveRun.running = false;
  } else {
    state.liveRun.startedAtMs = Date.now(); state.liveRun.running = true;
  }
  persistLiveRunState(); renderLiveRun();
}
function clearCanonicalInputMarker(input, type = 'distance') {
  if (!input) return;
  if (type === 'elevation') delete input.dataset.canonicalM;
  else delete input.dataset.canonicalKm;
  delete input.dataset.renderedValue;
}
function updateLiveRunDistance() {
  const liveInput = $('#live-run-distance');
  // An input event means the person intentionally edited the displayed value.
  // Clear the exact-display marker first so their typed value is converted exactly.
  clearCanonicalInputMarker(liveInput);
  state.liveRun.distanceKm = canonicalDistanceFromInput(liveInput, 0);
  persistLiveRunState(); renderLiveRun();
}
function updateLiveRunMeta() {
  state.liveRun.type = $('#live-run-type').value || 'Easy'; state.liveRun.routeName = $('#live-run-route').value.trim().slice(0, 80);
  persistLiveRunState(); renderLiveRun();
}
function resetLiveRun() {
  const hasProgress = liveRunElapsedMs() > 0 || state.liveRun.distanceKm > 0;
  const performReset = () => {
    state.liveRun = { running: false, startedAtMs: null, elapsedMs: 0, distanceKm: 0, type: 'Easy', routeName: '' };
    try { localStorage.removeItem(LIVE_RUN_STORAGE_KEY); } catch (_) { /* non-critical */ }
    renderLiveRun(); showToast('Live run reset', 'The stopwatch and live details are ready for a fresh start.');
  };
  if (hasProgress) showConfirm({ title: 'Reset this live run?', message: 'Its elapsed time and unsaved details will be cleared.', confirmText: 'Reset run', action: performReset }); else performReset();
}
function finishLiveRun() {
  if (state.liveRun.running) toggleLiveRun();
  const elapsedSeconds = Math.floor(liveRunElapsedMs() / 1000);
  if (elapsedSeconds < 1) return showToast('Start the timer first', 'The live run needs at least one second before review.', 'error');
  const h = Math.floor(elapsedSeconds / 3600); const m = Math.floor((elapsedSeconds % 3600) / 60); const s = elapsedSeconds % 60;
  $('#run-hours').value = h; $('#run-minutes').value = m; $('#run-seconds').value = s;
  if (state.liveRun.distanceKm > 0) setDistanceInputFromCanonical($('#run-distance'), state.liveRun.distanceKm, 3);
  else { $('#run-distance').value = ''; delete $('#run-distance').dataset.canonicalKm; delete $('#run-distance').dataset.renderedValue; }
  $('#run-date').value = todayISO(); $('#run-type').value = state.liveRun.type || 'Easy'; $('#run-route').value = state.liveRun.routeName || '';
  state.editingRunId = null; $('#run-form button[type="submit"]').innerHTML = '<i data-lucide="check"></i>Save run';
  updateRunPreview(); navigateTo('log-run'); initIcons();
  showToast('Live time added', 'Review distance and optional details, then save the run.');
}

function bindEvents() {
  $('#sign-in-form').addEventListener('submit', event => handleAuthSubmit(event, 'signin'));
  $('#register-form').addEventListener('submit', event => handleAuthSubmit(event, 'register'));
  $('#auth-switch').addEventListener('click', () => {
    const registering = !$('#register-form').classList.contains('hidden');
    $('#register-form').classList.toggle('hidden', registering); $('#sign-in-form').classList.toggle('hidden', !registering);
    $('#auth-title').textContent = registering ? 'Welcome back' : 'Start your running story'; $('#auth-subtitle').textContent = registering ? 'Sign in to continue your training.' : 'Create a private home for every run.';
    $('#auth-switch').innerHTML = registering ? 'New here? <strong>Create an account</strong>' : 'Already running with us? <strong>Sign in</strong>';
    setAuthMessage('');
  });
  $('#run-form').addEventListener('submit', handleRunSubmit);
  // Preserve exact canonical values only until a field is actually edited.
  // This lets clean rounded inputs switch units without drift, while a person’s
  // newly typed number always becomes the new exact saved value.
  ['#run-distance', '#settings-weekly-goal', '#settings-monthly-goal'].forEach(selector => {
    $(selector).addEventListener('input', () => clearCanonicalInputMarker($(selector)));
  });
  $('#run-elevation').addEventListener('input', () => clearCanonicalInputMarker($('#run-elevation'), 'elevation'));
  ['#run-distance','#run-hours','#run-minutes','#run-seconds','#run-type'].forEach(selector => $(selector).addEventListener('input', updateRunPreview));
  $('#live-run-start-pause').addEventListener('click', toggleLiveRun); $('#live-run-reset').addEventListener('click', resetLiveRun); $('#live-run-finish').addEventListener('click', finishLiveRun);
  $('#live-run-distance').addEventListener('input', updateLiveRunDistance); $('#live-run-type').addEventListener('change', updateLiveRunMeta); $('#live-run-route').addEventListener('input', updateLiveRunMeta);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderLiveRun(); });
  $('#discard-run-btn').addEventListener('click', () => { state.editingRunId = null; resetRunForm(); showToast('Form cleared', 'Ready whenever your next run is.'); });
  $('#quick-log-btn').addEventListener('click', () => navigateTo('log-run'));
  $('#sidebar-open').addEventListener('click', () => $('#sidebar').classList.add('open'));
  $('#sidebar-close').addEventListener('click', () => $('#sidebar').classList.remove('open'));
  $('#profile-menu-btn').addEventListener('click', () => $('#profile-menu').classList.toggle('hidden'));
  $('#theme-toggle').addEventListener('click', () => { document.body.classList.toggle('light-theme'); localStorage.setItem('fytrun-theme', document.body.classList.contains('light-theme') ? 'light' : 'dark'); setupChartDefaults(); renderAll(); });
  $('#sign-out-btn').addEventListener('click', signOut); document.addEventListener('click', event => { if (!event.target.closest('#profile-menu') && !event.target.closest('#profile-menu-btn')) $('#profile-menu').classList.add('hidden'); });
  $('#history-search').addEventListener('input', applyHistoryFilters); ['#filter-run-type','#filter-distance','#history-sort'].forEach(selector => $(selector).addEventListener('change', applyHistoryFilters));
  $('#calendar-prev').addEventListener('click', () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1); renderCalendar(); });
  $('#calendar-next').addEventListener('click', () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1); renderCalendar(); });
  $('#friend-search-btn').addEventListener('click', searchFriends); $('#friend-search').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchFriends(); } });
  $('#goal-settings-form').addEventListener('submit', saveGoals); $('#privacy-settings-form').addEventListener('submit', savePrivacy);
  $('#export-csv-btn').addEventListener('click', exportCSV); $('#settings-export-btn').addEventListener('click', exportCSV); $('#import-csv-input').addEventListener('change', event => importCSV(event.target.files[0]));
  $('#edit-profile-btn')?.addEventListener('click', openProfileModal); $('#profile-form').addEventListener('submit', saveProfile); $('#profile-image-input').addEventListener('change', event => previewProfilePhoto(event.target.files[0]));
  $('#change-password-btn').addEventListener('click', () => $('#password-modal').classList.remove('hidden')); $('#password-form').addEventListener('submit', savePassword); $('#delete-account-btn').addEventListener('click', deleteAccount);
  $('#back-to-friends').addEventListener('click', () => navigateTo('friends')); $('#back-to-friend-profile').addEventListener('click', () => navigateTo('friend-profile'));
  $('#confirm-cancel').addEventListener('click', () => closeModal('confirm-modal')); $('#confirm-action').addEventListener('click', async () => { const action = state.confirmAction; state.confirmAction = null; closeModal('confirm-modal'); if (action) await action(); });
  $$('.modal-backdrop, [data-close-modal]').forEach(el => el.addEventListener('click', () => closeModal(el.dataset.closeModal)));
  document.addEventListener('click', event => handleDelegatedClick(event));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') $$('.modal').forEach(modal => modal.classList.add('hidden')); });
  window.addEventListener('hashchange', () => navigateTo(location.hash.slice(1) || 'dashboard', false));
  const savedTheme = localStorage.getItem('fytrun-theme'); if (savedTheme === 'light') document.body.classList.add('light-theme');
}

async function handleDelegatedClick(event) {
  const unitChoice = event.target.closest('[data-distance-unit-choice]');
  if (unitChoice) { await setDistanceUnit(unitChoice.dataset.distanceUnitChoice); return; }
  const nav = event.target.closest('[data-view]');
  if (nav && nav.dataset.view) { event.preventDefault(); navigateTo(nav.dataset.view); if (nav.closest('#profile-menu')) $('#profile-menu').classList.add('hidden'); return; }
  const runEl = event.target.closest('[data-run-id]');
  if (runEl) {
    const id = runEl.dataset.runId; const isFriend = runEl.dataset.friendRun === 'true';
    const run = (isFriend ? state.friendRuns : state.runs).find(item => item.id === id); if (run) openRunModal(run, { isFriendRun: isFriend }); return;
  }
  const range = event.target.closest('[data-range]');
  if (range) {
    const control = range.closest('[data-range-control]'); $$('.active', control).forEach(button => button.classList.remove('active')); range.classList.add('active');
    if (control.dataset.rangeControl === 'dashboard-distance') { state.dashboardRange = range.dataset.range; renderDashboardChart(); }
    if (control.dataset.rangeControl === 'progress') { state.progressRange = range.dataset.range; renderProgress(); }
    return;
  }
  const reset = event.target.closest('.reset-chart');
  if (reset) { state.charts[reset.dataset.chart]?.resetZoom(); return; }
  const send = event.target.closest('[data-send-request]'); if (send) { await sendFriendRequest(send.dataset.sendRequest); return; }
  const request = event.target.closest('[data-request-action]'); if (request) { await respondFriendRequest(request.dataset.requestId, request.dataset.requestAction === 'accept' ? 'accepted' : 'declined'); return; }
  const friend = event.target.closest('[data-friend-id]'); if (friend) { await openFriendProfile(friend.dataset.friendId); return; }
  if (event.target.closest('#edit-profile-btn')) { openProfileModal(); return; }
  if (event.target.closest('#compare-btn')) { navigateTo('compare'); return; }
  if (event.target.closest('#remove-friend-btn')) { await removeFriend(); return; }
  if (event.target.closest('#sidebar-signout')) { await signOut(); return; }
  if (event.target.closest('#clear-history-search')) { $('#history-search').value = ''; applyHistoryFilters(); return; }
  const menuView = event.target.closest('#profile-menu [data-view]'); if (menuView) { navigateTo(menuView.dataset.view); $('#profile-menu').classList.add('hidden'); }
}

async function signOut() {
  try { const { error } = await supabase.auth.signOut(); if (error) throw error; } catch (error) { showToast('Could not sign out', error.message, 'error'); }
}

boot();
