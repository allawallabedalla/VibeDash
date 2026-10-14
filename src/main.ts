import { mount } from 'svelte';
import Gallery from './gallery/Gallery.svelte';
import { i18n } from './i18n/index.svelte';
import './styles/tokens.css';

const params = new URLSearchParams(window.location.search);
const theme = params.get('theme');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
document.documentElement.lang = i18n.locale;

mount(Gallery, { target: document.getElementById('app')! });
