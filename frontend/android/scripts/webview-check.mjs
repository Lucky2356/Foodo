// Emulator smoke test, debug build only: connects to the app's WebView through the DevTools
// socket (WebView debugging is enabled only in debuggable builds) and checks that the Foodo UI
// rendered, the Capacitor bridge and both Foodo plugins are present, no service worker is
// registered, and the native version equals VERSION.
//
//   node webview-check.mjs <devtools-port> <expected-version>
// Node 22+ (global fetch and WebSocket).
const [port, expectedVersion] = process.argv.slice(2);

async function pageTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((t) => t.type === 'page' && t.url.startsWith('https://localhost'));
      if (page) return page;
    } catch {
      // DevTools socket not ready yet.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('No https://localhost page in the WebView DevTools targets');
}

function evaluate(ws, expression) {
  const id = Math.floor(Math.random() * 1e9);
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error || msg.result?.exceptionDetails) reject(new Error(JSON.stringify(msg.error ?? msg.result.exceptionDetails)));
      else resolve(msg.result.result.value);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
}

const target = await pageTarget();
console.log(`WebView page: ${target.title} — ${target.url}`);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let state;
for (let i = 0; i < 30; i++) {
  state = await evaluate(
    ws,
    `(async () => ({
      title: document.title,
      nav: Array.from(document.querySelectorAll('.bottom-nav a')).map((a) => a.textContent.trim()),
      native: Boolean(window.Capacitor && window.Capacitor.isNativePlatform()),
      updater: Boolean(window.Capacitor && window.Capacitor.isPluginAvailable('FoodoUpdater')),
      files: Boolean(window.Capacitor && window.Capacitor.isPluginAvailable('FoodoFiles')),
      serviceWorkers: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
      csp: Boolean(document.querySelector('meta[http-equiv="Content-Security-Policy"]')),
    }))()`,
  );
  if (state.nav.length > 0) break;
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(JSON.stringify(state, null, 2));

const info = await evaluate(ws, 'window.Capacitor.Plugins.FoodoUpdater.getInfo()');
console.log('FoodoUpdater.getInfo():', JSON.stringify(info));
// Informational only: a real anonymous request to the GitHub API (may be rate-limited on shared runners).
try {
  console.log('FoodoUpdater.check():', JSON.stringify(await evaluate(ws, 'window.Capacitor.Plugins.FoodoUpdater.check()')));
} catch (e) {
  console.log('FoodoUpdater.check() rejected (not fatal here):', JSON.stringify(String(e.message)));
}
ws.close();

const failures = [];
if (!state.title.includes('Foodo')) failures.push('title does not contain Foodo');
if (!state.nav.includes('Меню') || !state.nav.includes('Покупки')) failures.push('main navigation not rendered');
if (!state.native) failures.push('Capacitor native bridge missing');
if (!state.updater || !state.files) failures.push('Foodo plugins not registered');
if (state.serviceWorkers !== 0) failures.push('a service worker is registered');
if (!state.csp) failures.push('CSP meta tag missing');
// JSON.stringify escapes line breaks, so a value from the app cannot forge extra log lines.
if (info.versionName !== expectedVersion) failures.push(`versionName ${JSON.stringify(info.versionName)} != ${JSON.stringify(expectedVersion)}`);
if (failures.length) {
  console.error('FAILED:', failures.join('; '));
  process.exit(1);
}
console.log('WebView checks passed');
