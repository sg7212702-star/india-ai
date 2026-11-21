import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

const $ = (id) => document.getElementById(id);
const statusLabel = $('adminAuthStatus');
const loginHint = $('adminLoginHint');
const dashboard = $('adminDashboard');
const metricsGrid = $('metricsGrid');
const usersTable = $('usersTable');
const jobsTable = $('jobsTable');
const usersStatus = $('usersStatus');
const jobsStatus = $('jobsStatus');
const usersNext = $('usersNext');
const jobStatusFilter = $('jobStatusFilter');
let auth = null;
let adminUser = null;
let userPageToken = null;
let userBusy = false;
let jobsBusy = false;
let overviewBusy = false;

function setStatus(message, state = 'info') {
  statusLabel.textContent = message;
  statusLabel.dataset.state = state;
}
function dateText(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}
function makeCell(text, className = '') {
  const cell = document.createElement('td');
  cell.textContent = text == null || text === '' ? '—' : String(text);
  if (className) cell.className = className;
  return cell;
}
function emptyRow(target, message, columnCount) {
  const row = document.createElement('tr');
  const cell = makeCell(message, 'empty-cell');
  cell.colSpan = columnCount;
  row.append(cell);
  target.replaceChildren(row);
}
async function api(url, user = adminUser) {
  if (!user) throw new Error('Admin sign-in is required.');
  const token = await user.getIdToken();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}
function metricCard(title, value, hint) {
  const card = document.createElement('article');
  card.className = 'metric-card';
  const label = document.createElement('span'); label.className = 'metric-label'; label.textContent = title;
  const number = document.createElement('strong'); number.className = 'metric-number'; number.textContent = String(value);
  const note = document.createElement('small'); note.textContent = hint;
  card.append(label, number, note);
  return card;
}
async function loadOverview() {
  if (!adminUser || overviewBusy) return;
  overviewBusy = true;
  try {
    const data = await api('/api/admin/overview');
    const counts = data.jobs?.counts || {};
    metricsGrid.replaceChildren(
      metricCard('Users sampled', data.users?.sampledCount ?? '—', data.users?.moreAvailable ? 'More than 1,000 users exist; sample shown' : 'First Auth page sampled'),
      metricCard('Queued jobs', counts.queued ?? 0, 'In the scanned recent-job window'),
      metricCard('Processing jobs', counts.processing ?? 0, 'In the scanned recent-job window'),
      metricCard('Completed jobs', counts.completed ?? 0, 'In the scanned recent-job window'),
      metricCard('Failed jobs', counts.failed ?? 0, 'In the scanned recent-job window'),
      metricCard('Scanned jobs', data.jobs?.scannedCount ?? 0, `Latest ${data.jobs?.scanLimit ?? 100} records`)
    );
    $('overviewMeta').textContent = data.jobs?.scanLimitReached
      ? `Counts cover the latest ${data.jobs.scanLimit} scanned jobs and may omit older records. User count is a sample, not a total.`
      : 'Counts cover the records currently returned. User count is a sample, not a total.';
  } catch (error) {
    $('overviewMeta').textContent = error.message || 'Overview unavailable.';
  } finally { overviewBusy = false; }
}
async function loadUsers(pageToken = null) {
  if (!adminUser || userBusy) return;
  userBusy = true;
  usersStatus.textContent = 'Loading account records…';
  usersNext.disabled = true;
  try {
    const url = new URL('/api/admin/users', location.origin);
    url.searchParams.set('limit', '25');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await api(url.pathname + url.search);
    const rows = (data.items || []).map((user) => {
      const row = document.createElement('tr');
      const account = document.createElement('td');
      const strong = document.createElement('strong'); strong.textContent = user.displayName || '(No display name)';
      const email = document.createElement('small'); email.textContent = user.email || 'No email';
      account.append(strong, email);
      row.append(account, makeCell(user.emailVerified ? 'Yes' : 'No'), makeCell(user.disabled ? 'Disabled' : 'Active'), makeCell(dateText(user.lastSignInAt)), makeCell(user.uid, 'uid-cell'));
      return row;
    });
    if (rows.length) usersTable.replaceChildren(...rows);
    else emptyRow(usersTable, 'No accounts returned.', 5);
    userPageToken = data.nextPageToken || null;
    usersNext.disabled = !userPageToken;
    usersStatus.textContent = `${rows.length} account(s) on this page. Creation date and provider details are available from the API but not shown in this table.`;
  } catch (error) {
    usersStatus.textContent = error.message || 'Could not load accounts.';
    emptyRow(usersTable, 'Account list unavailable.', 5);
  } finally { userBusy = false; }
}
async function loadJobs() {
  if (!adminUser || jobsBusy) return;
  jobsBusy = true;
  jobsStatus.textContent = 'Loading recent jobs…';
  try {
    const url = new URL('/api/admin/jobs', location.origin);
    url.searchParams.set('limit', '25');
    if (jobStatusFilter.value) url.searchParams.set('status', jobStatusFilter.value);
    const data = await api(url.pathname + url.search);
    const rows = (data.items || []).map((job) => {
      const row = document.createElement('tr');
      row.append(
        makeCell(job.request?.title || job.jobId),
        makeCell(job.uid, 'uid-cell'),
        makeCell(job.status, `status-cell status-${job.status}`),
        makeCell(`${job.request?.style || '—'} · ${job.request?.aspectRatio || '—'} · ${job.request?.durationSeconds ?? '—'}s`),
        makeCell(dateText(job.createdAt)),
        makeCell(job.failureCode || '—')
      );
      return row;
    });
    if (rows.length) jobsTable.replaceChildren(...rows);
    else emptyRow(jobsTable, 'No jobs match this filter in the scanned window.', 6);
    jobsStatus.textContent = `Showing ${rows.length} job(s) from ${data.scannedCount} scanned records${data.scanLimitReached ? ' · scan limit reached, older jobs may be omitted' : ''}.`;
  } catch (error) {
    jobsStatus.textContent = error.message || 'Could not load jobs.';
    emptyRow(jobsTable, 'Job list unavailable.', 6);
  } finally { jobsBusy = false; }
}
async function refreshAll() {
  if (!adminUser) return;
  await Promise.all([loadOverview(), loadUsers(null), loadJobs()]);
}
async function boot() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    const config = await response.json();
    if (!config.firebaseWebConfigured || !config.firebase) {
      setStatus('Firebase Web app configuration is missing on the server.', 'warning');
      loginHint.hidden = false;
      return;
    }
    auth = getAuth(initializeApp(config.firebase));
    onAuthStateChanged(auth, async (user) => {
      adminUser = user;
      if (!user) {
        dashboard.hidden = true;
        loginHint.hidden = false;
        setStatus('Sign in through the Studio page, then open this console again.', 'warning');
        return;
      }
      setStatus('Verifying administrator role…');
      try {
        const profile = await api('/api/auth/me', user);
        if (profile.admin !== true) {
          dashboard.hidden = true;
          loginHint.hidden = false;
          setStatus('This account does not have the administrator claim.', 'error');
          return;
        }
        loginHint.hidden = true;
        dashboard.hidden = false;
        setStatus(`Verified administrator: ${profile.email || profile.uid}`, 'success');
        await refreshAll();
      } catch (error) {
        dashboard.hidden = true;
        loginHint.hidden = false;
        setStatus(error.message || 'Administrator verification failed.', 'error');
      }
    });
  } catch (error) {
    setStatus(error.message || 'Could not load Firebase configuration.', 'error');
    loginHint.hidden = false;
  }
}
$('adminRefresh')?.addEventListener('click', refreshAll);
$('usersRefresh')?.addEventListener('click', () => loadUsers(null));
$('jobsRefresh')?.addEventListener('click', loadJobs);
usersNext?.addEventListener('click', () => userPageToken && loadUsers(userPageToken));
jobStatusFilter?.addEventListener('change', loadJobs);
boot();
