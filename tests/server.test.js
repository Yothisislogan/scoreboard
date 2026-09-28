import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from '../server.js';

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('serves the app with the right content types', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /Gridiron Scoreboard/);

  const script = await fetch(`${base}/assets/js/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /text\/javascript/);

  const head = await fetch(`${base}/assets/css/styles.css`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.match(head.headers.get('content-type'), /text\/css/);
});

test('refuses hidden files, traversal and unknown paths', async () => {
  for (const path of ['/.git/config', '/%2e%2e/%2e%2e/etc/passwd', '/assets/..%2f..%2fpackage.json', '/missing.html']) {
    const response = await fetch(`${base}${path}`);
    assert.ok([403, 404].includes(response.status), `${path} -> ${response.status}`);
  }
  const bad = await fetch(`${base}/%E0%A4%A`);
  assert.equal(bad.status, 400);
  const post = await fetch(`${base}/`, { method: 'POST' });
  assert.equal(post.status, 405);
});

test('the ESPN relay only forwards football API paths', async () => {
  const response = await fetch(`${base}/espn/apis/site/v2/sports/baseball/mlb/scoreboard`);
  assert.equal(response.status, 404);
  const sneaky = await fetch(`${base}/espn/@evil.example.com/steal`);
  assert.equal(sneaky.status, 404);
});
