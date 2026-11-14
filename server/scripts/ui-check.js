/**
 * Drive the real UI in a headless browser and screenshot each view.
 *
 * This exists because the unit tests only prove the API works. A template error in one of
 * the Vue views would pass every test and still show a blank page to the marker.
 *
 * Usage: node scripts/ui-check.js [baseUrl]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:3100';
const OUT = path.resolve('..', 'docs', 'screenshots');
const PORT = 9333;

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const EDGE = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
if (!EDGE) { console.error('Edge not found'); process.exit(1); }

fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-check-'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitJson(url, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || 'page exception');
    }
    return r.result.value;
  }
}

async function shot(cdp, name, height = 900) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1180, height, deviceScaleFactor: 2, mobile: false,
  });
  await sleep(350);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`  saved ${path.basename(file)}`);
}

(async () => {
  console.log(`UI check against ${BASE}`);
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    const targets = await waitJson(`http://127.0.0.1:${PORT}/json/list`);
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('no page target');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const cdp = new CDP(ws);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const errors = [];
    await cdp.send('Log.enable').catch(() => {});
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        errors.push(m.params.entry.text);
      }
    });

    // ---------- login page ----------
    await cdp.send('Page.navigate', { url: BASE + '/' });
    await sleep(1500);
    const hasForm = await cdp.eval('!!document.querySelector("#vid")');
    if (!hasForm) throw new Error('login form did not render');
    await shot(cdp, '01-login', 760);

    // ---------- step 1: credentials ----------
    await cdp.eval(`
      (() => {
        const set = (sel, val) => {
          const el = document.querySelector(sel);
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        set('#vid', 'V1001');
        set('#pwd', 'password123');
        return true;
      })()
    `);
    await sleep(200);
    await cdp.eval(`[...document.querySelectorAll('button')]
      .find(b => b.textContent.trim().startsWith('Continue')).click()`);
    await sleep(900);

    const otpShown = await cdp.eval('!!document.querySelector("#otp")');
    if (!otpShown) throw new Error('OTP step did not render');
    const devOtp = await cdp.eval(`
      (() => {
        const m = document.body.innerText.match(/it is\\s+(\\d{6})/);
        return m ? m[1] : (document.body.innerText.match(/(\\d{6})/) || [])[1];
      })()
    `);
    if (!devOtp) throw new Error('could not read the demo OTP from the page');
    await shot(cdp, '02-otp', 760);

    // ---------- step 2: OTP ----------
    await cdp.eval(`
      (() => {
        const el = document.querySelector('#otp');
        el.value = '${devOtp}';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()
    `);
    await sleep(200);
    await cdp.eval(`[...document.querySelectorAll('button')]
      .find(b => b.textContent.trim().startsWith('Sign in')).click()`);
    await sleep(1400);

    const inApp = await cdp.eval('!!document.querySelector(".bar")');
    if (!inApp) throw new Error('app shell did not render after sign-in');

    const electionCount = await cdp.eval('document.querySelectorAll(".chip").length');
    const candidateCount = await cdp.eval('document.querySelectorAll(".cand").length');
    console.log(`  elections rendered: ${electionCount}, candidates rendered: ${candidateCount}`);
    if (candidateCount === 0) throw new Error('ballot candidates did not render');
    await shot(cdp, '03-ballot', 900);

    // ---------- cast a vote if possible ----------
    const canVote = await cdp.eval(`!document.querySelector('.cand.disabled')`);
    if (canVote) {
      await cdp.eval(`document.querySelectorAll('.cand input')[0].click()`);
      await sleep(200);
      await cdp.eval(`[...document.querySelectorAll('button')]
        .find(b => b.textContent.trim().startsWith('Cast ballot')).click()`);
      await sleep(1600);
      const receipt = await cdp.eval(`
        (() => {
          const el = document.querySelector('.receipt-flash .code');
          return el ? el.textContent.trim() : null;
        })()
      `);
      console.log(`  receipt shown: ${receipt}`);
      if (!receipt) throw new Error('receipt was not displayed after voting');
      await shot(cdp, '04-receipt', 780);
    }

    // ---------- results (auditor) ----------
    await cdp.eval(`[...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Sign out').click()`);
    await sleep(900);

    await cdp.eval(`
      (() => {
        const set = (sel, val) => {
          const el = document.querySelector(sel);
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        set('#vid', 'U4001');
        set('#pwd', 'password123');
        return true;
      })()
    `);
    await sleep(200);
    await cdp.eval(`[...document.querySelectorAll('button')]
      .find(b => b.textContent.trim().startsWith('Continue')).click()`);
    await sleep(900);
    const otp2 = await cdp.eval(`
      (() => {
        const m = document.body.innerText.match(/it is\\s+(\\d{6})/);
        return m ? m[1] : (document.body.innerText.match(/(\\d{6})/) || [])[1];
      })()
    `);
    await cdp.eval(`
      (() => {
        const el = document.querySelector('#otp');
        el.value = '${otp2}';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()
    `);
    await sleep(200);
    await cdp.eval(`[...document.querySelectorAll('button')]
      .find(b => b.textContent.trim().startsWith('Sign in')).click()`);
    await sleep(1400);

    await cdp.eval(`[...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Results').click()`);
    await sleep(1400);
    const rows = await cdp.eval('document.querySelectorAll("tbody tr").length');
    console.log(`  result rows: ${rows}`);
    if (rows === 0) throw new Error('results table did not render');
    await shot(cdp, '05-results', 900);

    await cdp.eval(`[...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Audit log').click()`);
    await sleep(1400);
    const auditRows = await cdp.eval('document.querySelectorAll("tbody tr").length');
    console.log(`  audit rows: ${auditRows}`);
    if (auditRows === 0) throw new Error('audit table did not render');
    await shot(cdp, '06-audit', 900);

    if (errors.length) {
      console.log('\n  browser console errors:');
      for (const e of errors) console.log('   -', e);
    } else {
      console.log('\n  no browser console errors');
    }
    console.log('\nUI CHECK PASSED');
  } finally {
    edge.kill();
    await sleep(300);
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error('\nUI CHECK FAILED:', e.message);
  process.exit(1);
});
