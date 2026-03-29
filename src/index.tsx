import { render } from 'solid-js/web';
import { Show, createSignal } from 'solid-js';
import { DialRoot } from 'dialkit/solid';
import App from './App';
import './styles/global.css';
import 'dialkit/styles.css';

const [showDials, setShowDials] = createSignal(true);

document.addEventListener('keydown', (e) => {
  if (e.altKey && e.code === 'KeyH') setShowDials(v => !v);
});

const root = document.getElementById('root');
if (root) {
  render(() => (
    <>
      <App />
      <Show when={showDials()}>
        <div style={{ position: 'fixed', inset: '0', 'pointer-events': 'none', 'z-index': '9999' }}>
          <div style={{ 'pointer-events': 'auto', position: 'absolute', top: '0', right: '0' }}>
            <DialRoot />
          </div>
        </div>
      </Show>
    </>
  ), root);
}
