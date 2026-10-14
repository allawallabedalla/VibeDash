import { mount } from 'svelte';
import App from './app/App.svelte';
import { i18n } from './i18n/index.svelte';
import './styles/tokens.css';
import './styles/layout.css';

const params = new URLSearchParams(window.location.search);
const theme = params.get('theme');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
document.documentElement.lang = i18n.locale;

mount(App, { target: document.getElementById('app')! });
