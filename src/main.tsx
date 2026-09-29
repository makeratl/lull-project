import { render } from 'preact';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource-variable/newsreader/opsz.css';
import './ui/styles.css';
import { App } from './App';
import { registerSW } from './sw';

render(<App />, document.getElementById('app')!);
registerSW();
