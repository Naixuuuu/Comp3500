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

/** Click a button by its visible text, retrying while Vue catches up. */
async function clickText(cdp, text, { exact = false, tries = 30 } = {}) {
  const want = JSON.stringify(text);
  for (let i = 0; i < tries; i += 1) {
    const hit = await cdp.eval(`
      (() => {
        const t = ${want};
        const el = [...document.querySelectorAll('button')].find((b) => ${exact
          ? 'b.textContent.trim() === t'
          : 'b.textContent.trim().startsWith(t)'});
        if (!el) return false;
        el.click();
        return true;
      })()
    `);
    if (hit) return;
    await sleep(200);
  }
  const available = await cdp.eval(
    `[...document.querySelectorAll('button')].map((b) => b.textContent.trim())`
  );
  throw new Error(`button "${text}" never appeared. Present: ${JSON.stringify(available)}`);
}

/** Type into a selector, retrying until the element exists. */
async function fill(cdp, selector, value) {
  const sel = JSON.stringify(selector);
  const val = JSON.stringify(value);
  for (let i = 0; i < 30; i += 1) {
    const ok = await cdp.eval(`
      (() => {
        const el = document.querySelector(${sel});
        if (!el) return false;
        el.value = ${val};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()
    `);
    if (ok) return;
    await sleep(200);
  }
  throw new Error(`input "${selector}" never appeared`);
}

async function text(cdp, selector) {
  return cdp.eval(`
    (() => { const el = document.querySelector(${JSON.stringify(selector)});
             return el ? el.textContent.trim() : null; })()
  `);
}

/** Read the demo OTP that the login screen shows in its hint box. */
async function readOtp(cdp) {
  for (let i = 0; i < 30; i += 1) {
    const code = await cdp.eval(`
      (() => {
        const m = document.body.innerText.match(/it is\\s+(\\d{6})/);
        if (m) return m[1];
        const m2 = document.body.innerText.match(/(\\d{6})/);
        return m2 ? m2[1] : null;
      })()
    `);
    if (code) return code;
    await sleep(200);
  }
  throw new Error('could not read the demo OTP from the page');
}

async function signIn(cdp, voterId) {
  await fill(cdp, '#vid', voterId);
  await fill(cdp, '#pwd', 'password123');
  await clickText(cdp, 'Continue');
  const code = await readOtp(cdp);
  await fill(cdp, '#otp', code);
  await clickText(cdp, 'Sign in');
  await sleep(1200);
  const shell = await cdp.eval('!!document.querySelector(".bar")');
  if (!shell) throw new Error(`sign-in as ${voterId} did not reach the app shell`);
}

async function shot(cdp, name, height = 900) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1180, height, deviceScaleFactor: 2, mobile: false,
  });
  await sleep(400);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  saved ${name}.png`);
}

(async () => {
  console.log(`UI check against ${BASE}`);
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
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
    await cdp.send('Log.enable').catch(() => {});
    const errors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        errors.push(m.params.entry.text);
      }
    });

    // ================= 1. login screen =================
    await cdp.send('Page.navigate', { url: BASE + '/' });
    await sleep(1500);
    if (!(await cdp.eval('!!document.querySelector("#vid")'))) {
      throw new Error('login form did not render');
    }
    await shot(cdp, '01-login', 760);

    // ================= 2. two-factor sign-in =================
    await fill(cdp, '#vid', 'V1001');
    await fill(cdp, '#pwd', 'password123');
    await clickText(cdp, 'Continue');
    await readOtp(cdp);
    await shot(cdp, '02-otp', 760);
    const otp = await readOtp(cdp);
    await fill(cdp, '#otp', otp);
    await clickText(cdp, 'Sign in');
    await sleep(1300);

    // ================= 3. ballot =================
    const candidates = await cdp.eval('document.querySelectorAll(".cand").length');
    console.log(`  candidates rendered: ${candidates}`);
    if (candidates === 0) throw new Error('ballot candidates did not render');
    await shot(cdp, '03-ballot', 900);

    // ================= 4. vote =================
    const canVote = await cdp.eval("!document.querySelector('.cand.disabled')");
    if (!canVote) {
      throw new Error('V1001 cannot vote — this database has already been used. '
        + 'Delete server/data/ and restart for a full run.');
    }
    await cdp.eval(`document.querySelectorAll('.cand input')[0].click()`);
    await sleep(200);
    await clickText(cdp, 'Cast ballot');
    await sleep(1600);
    const receipt = await text(cdp, '.receipt-flash .code');
    if (!receipt) throw new Error('receipt was not displayed after voting');
    console.log(`  receipt shown: ${receipt}`);
    await shot(cdp, '04-receipt', 780);

    // ================= 5. auditor: results and audit log =================
    await clickText(cdp, 'Sign out', { exact: true });
    await sleep(900);
    await signIn(cdp, 'U4001');

    await clickText(cdp, 'Results', { exact: true });
    await sleep(1400);
    const rows = await cdp.eval('document.querySelectorAll("tbody tr").length');
    console.log(`  result rows: ${rows}`);
    if (rows === 0) throw new Error('results table did not render');
    const invariant = await text(cdp, '.stat.good .n');
    console.log(`  D2 invariant badge: ${invariant}`);
    await shot(cdp, '05-results', 900);

    await clickText(cdp, 'Audit log', { exact: true });
    await sleep(1400);
    const auditRows = await cdp.eval('document.querySelectorAll("tbody tr").length');
    console.log(`  audit rows: ${auditRows}`);
    if (auditRows === 0) throw new Error('audit table did not render');
    await shot(cdp, '06-audit', 900);

    // ================= 6. administrator: create, edit, candidates, open =================
    await clickText(cdp, 'Sign out', { exact: true });
    await sleep(900);
    await signIn(cdp, 'A3001');

    const hasAdminTab = await cdp.eval(
      `!![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Admin')`
    );
    if (!hasAdminTab) throw new Error('the Admin tab is missing for an administrator');
    await clickText(cdp, 'Admin', { exact: true });
    await sleep(1000);

    // The create form pre-fills a one-week window, so only the title has to be typed.
    const prefill = await cdp.eval(`
      (() => {
        const d = document.querySelectorAll('.create .dt input');
        return { count: d.length, opens: d[0]?.value || '', closes: d[1]?.value || '' };
      })()
    `);
    console.log(`  create form window inputs: ${prefill.count} (opens=${prefill.opens})`);
    if (prefill.count !== 2 || !prefill.opens || !prefill.closes) {
      throw new Error('the voting-window inputs are missing from the create form');
    }

    const title = `E2E Election ${Date.now()}`;
    await fill(cdp, '.create > input', title);
    await clickText(cdp, 'Create election');
    await sleep(1500);
    if (!(await cdp.eval(`document.body.innerText.includes(${JSON.stringify(title)})`))) {
      throw new Error('the new election did not appear in the admin view');
    }
    console.log(`  created election: ${title}`);

    const windowShown = await cdp.eval(`
      (() => { const el = document.querySelector('.window-line .wvalue');
               return el ? el.textContent.trim() : null; })()
    `);
    console.log(`  window shown in admin: ${windowShown}`);
    if (!windowShown || !windowShown.includes('→')) {
      throw new Error('the voting window is not shown for the selected election');
    }

    for (const [name, party] of [['Wong Tin-lok', 'List A'], ['Cheung Mei', 'List B']]) {
      await fill(cdp, '.row input:nth-of-type(1)', name);
      await fill(cdp, '.row input:nth-of-type(2)', party);
      await clickText(cdp, 'Add', { exact: true });
      await sleep(1200);
    }
    let candRows = await cdp.eval('document.querySelectorAll("table tbody tr").length');
    console.log(`  candidates added: ${candRows}`);
    if (candRows < 2) throw new Error('candidates did not appear in the admin table');

    // ---- edit the election (title + window) ----
    await clickText(cdp, 'Edit', { exact: true });
    await sleep(600);
    const editedTitle = `${title} (edited)`;
    await fill(cdp, '.edit-form .dt.wide input', editedTitle);
    await clickText(cdp, 'Save changes');
    await sleep(1400);
    const renamed = await cdp.eval(`document.body.innerText.includes(${JSON.stringify(editedTitle)})`);
    console.log(`  renamed to: ${editedTitle} -> ${renamed ? 'ok' : 'NOT SHOWN'}`);
    if (!renamed) throw new Error('editing the election title did not take effect');
    await shot(cdp, '07-admin', 1040);

    // ---- add a third candidate, then remove it, to exercise candidate editing ----
    await fill(cdp, '.row input:nth-of-type(1)', 'Temp Candidate');
    await fill(cdp, '.row input:nth-of-type(2)', 'Temp Party');
    await clickText(cdp, 'Add', { exact: true });
    await sleep(1200);
    const threeRows = await cdp.eval('document.querySelectorAll("table tbody tr").length');
    if (threeRows !== 3) throw new Error(`expected 3 candidates, got ${threeRows}`);

    const confirmed = await cdp.eval(`
      (() => {
        window.__confirmAnswer = true;
        window.confirm = () => true;
        const row = [...document.querySelectorAll('table tbody tr')]
          .find((tr) => tr.textContent.includes('Temp Candidate'));
        if (!row) return false;
        row.querySelector('button.danger').click();
        return true;
      })()
    `);
    if (!confirmed) throw new Error('could not find the Remove button for the third candidate');
    await sleep(1400);
    candRows = await cdp.eval('document.querySelectorAll("table tbody tr").length');
    console.log(`  candidates after removing one: ${candRows}`);
    if (candRows !== 2) throw new Error(`expected 2 candidates after removal, got ${candRows}`);

    // ---- open the session ----
    await clickText(cdp, 'Open voting session');
    await sleep(1500);
    const status = await text(cdp, '.detail .head .tag');
    console.log(`  status after opening: ${status}`);
    if (status !== 'open') throw new Error(`expected the session to open, got "${status}"`);

    // ================= 7. vote in the election that was just created =================
    await clickText(cdp, 'Ballot', { exact: true });
    await sleep(1300);
    const picked = await cdp.eval(`
      (() => {
        const chip = [...document.querySelectorAll('.elections .chip')]
          .find((c) => c.textContent.includes(${JSON.stringify(editedTitle)}));
        if (!chip) return false;
        chip.click();
        return true;
      })()
    `);
    if (!picked) throw new Error('the new election is missing from the ballot view');
    await sleep(1300);

    const windowOnBallot = await cdp.eval(`
      (() => {
        const rows = [...document.querySelectorAll('.window .wrow')];
        return rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim());
      })()
    `);
    console.log(`  window rows on the ballot: ${windowOnBallot.length}`);
    if (windowOnBallot.length !== 2) {
      throw new Error('the ballot is not showing the voting window');
    }

    const newCands = await cdp.eval('document.querySelectorAll(".cand").length');
    console.log(`  candidates on the new ballot: ${newCands}`);
    if (newCands !== 2) throw new Error('the new election should show exactly 2 candidates');

    await cdp.eval(`document.querySelectorAll('.cand input')[0].click()`);
    await sleep(200);
    await clickText(cdp, 'Cast ballot');
    await sleep(1700);
    const newReceipt = await text(cdp, '.receipt-flash .code');
    if (!newReceipt) throw new Error('voting in the newly created election returned no receipt');
    console.log(`  receipt for the new election: ${newReceipt}`);
    await shot(cdp, '08-new-election-vote', 820);

    if (errors.length) {
      console.log('\n  browser console errors:');
      for (const e of errors) console.log('   -', String(e).slice(0, 300));
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
