import { mount } from 'svelte';
import App from './app/App.svelte';
import { i18n } from './i18n/index.svelte';
import './styles/tokens.css';
import './styles/layout.css';

const params = new URLSearchParams(window.location.search);
const theme = params.get('theme');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
document.documentElement.lang = i18n.locale;

// A page part (Week, Forecasts …) is loaded on demand. A tab opened before a
// new release may ask for a file the new release no longer has: then reload
// once instead of showing an empty page (at most once a minute).
window.addEventListener('vite:preloadError', (event) => {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem('vd-reload') ?? 0);
  } catch {
    // no storage: reload anyway, the guard below keeps it to one try per load
  }
  if (Date.now() - last < 60_000) return;
  try {
    sessionStorage.setItem('vd-reload', String(Date.now()));
  } catch {
    // ignore
  }
  event.preventDefault();
  window.location.reload();
});

mount(App, { target: document.getElementById('app')! });
