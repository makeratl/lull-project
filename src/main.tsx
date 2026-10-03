import { render } from 'preact';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource-variable/newsreader/opsz.css';
import './ui/styles.css';
import { App } from './App';
import { registerSW } from './sw';
import { inject } from '@vercel/analytics';

render(<App />, document.getElementById('app')!);
registerSW();
// Vercel Web Analytics: page views only, cookieless. Query strings are dropped before sending,
// because Lull's carry secrets (?invite= codes, /reset?token_hash=).
inject({
  beforeSend: e => {
    const u = new URL(e.url);
    u.search = '';
    u.hash = '';
    return { ...e, url: u.toString() };
  },
});
