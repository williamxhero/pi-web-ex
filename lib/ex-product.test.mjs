import assert from 'node:assert/strict';
import test from 'node:test';
import ex from '../bin/ex-product.js';

test('compares both parts of an Ex release, in order', () => {
  assert.equal(ex.APP_VERSION, `${ex.UPSTREAM_VERSION}+${ex.FORK_VERSION}`);
  assert.equal(ex.isNewerExVersion('0.19.0+1.0.1', '0.19.0+1.0.0'), true);
  assert.equal(ex.isNewerExVersion('0.20.0+1.0.0', '0.19.0+9.0.0'), true);
  assert.equal(ex.isNewerExVersion('0.18.0+9.0.0', '0.19.0+1.0.0'), false);
  assert.equal(ex.isNewerExVersion('0.19.0+1.0.0', '0.19.0+1.0.0'), false);
  assert.equal(ex.isNewerExVersion('0.20.0', '0.19.0+1.0.0'), false);
  assert.equal(ex.isNewerExVersion('0.20.0+1.0.0-rc', '0.19.0+1.0.0'), false);
});

test('stable Ex Release checks construct their own install URL and distinguish missing releases/assets', async () => {
  const tag = 'v0.19.0+1.0.1';
  const from = (body, status = 200) => async (url) => {
    assert.equal(String(url), 'https://api.github.com/repos/williamxhero/pi-web-ex/releases/latest');
    return Response.json(body, { status });
  };
  assert.equal(await ex.fetchLatestExRelease(from({}, 404)), null);
  await assert.rejects(ex.fetchLatestExRelease(from({}, 403)), /403/);
  await assert.rejects(ex.fetchLatestExRelease(from({ tag_name: 'v0.20.0', assets: [] })), /invalid/i);
  await assert.rejects(ex.fetchLatestExRelease(from({ tag_name: tag, prerelease: true, assets: [] })), /invalid/i);
  await assert.rejects(ex.fetchLatestExRelease(from({ tag_name: tag, assets: [] })), /invalid/i);
  const stable = { tag_name: tag, draft: false, prerelease: false };
  assert.equal((await ex.fetchLatestExRelease(from({ ...stable, assets: [] }))).assetUrl, null);
  const release = await ex.fetchLatestExRelease(from({ ...stable, assets: [{ name: 'pi-web-ex.tgz', state: 'uploaded', browser_download_url: 'https://invalid.example/file' }] }));
  assert.equal(release.version, '0.19.0+1.0.1');
  assert.equal(release.url, 'https://github.com/williamxhero/pi-web-ex/releases/tag/v0.19.0%2B1.0.1');
  assert.equal(release.assetUrl, 'https://github.com/williamxhero/pi-web-ex/releases/download/v0.19.0%2B1.0.1/pi-web-ex.tgz');
});
