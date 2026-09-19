const { chromium } = require('C:/Users/Yuki1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

(async () => {
  const out = process.argv[2];
  if (!out) throw new Error('Pass the generated artifact directory.');
  const url = process.argv[3] || 'http://127.0.0.1:8767/';
  const manifest = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf8'));
  const pick = (items, preferred) => items.find(item=>item.id===preferred) || items[0];
  const defaults = {
    source: pick(manifest.sources, 'voice'), scene: pick(manifest.scenes, 'tour'),
    mode: pick(manifest.modes, 'natural'), method: pick(manifest.methods, manifest.default_method || 'room'),
  };
  const alternatives = manifest.methods.filter(method=>method.id!==defaults.method.id);
  assert.ok(alternatives.length >= 2, 'Method switching checks require at least three methods.');
  const first = alternatives[0].id, second = alternatives[1].id, initial = defaults.method.id;
  const findClip = (method, scene=defaults.scene.id, mode=defaults.mode.id, source=defaults.source.id) => {
    const clip = manifest.clips.find(c=>c.source===source && c.method===method && c.scene===scene && c.mode===mode);
    assert.ok(clip, `Missing clip: ${source}/${method}/${scene}/${mode}`);
    return clip;
  };
  const expectedCount = ['sources', 'methods', 'scenes', 'modes'].reduce((count, key)=>count*manifest[key].length, 1);
  assert.equal(manifest.clips.length, expectedCount, 'Manifest must contain the complete listening matrix.');
  const report = { url, errors: [], checks: [], metadataFiles: 0, expectedFiles: expectedCount };
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--disable-gpu'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(String(e)));
    page.on('console', msg => { if (msg.type() === 'error') report.errors.push(msg.text()); });
    await page.goto(url, { waitUntil: 'networkidle' });
    const card = method => page.locator('.method-card').filter({ has: page.getByRole('button', { name: '选择 '+manifest.methods.find(m=>m.id===method).label, exact: true }) });
    const audio = method => card(method).locator('audio');
    const select = method => card(method).getByRole('button', { name: /^选择 / });
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].every(a=>a.readyState>=2));
    assert.equal(await page.locator('.method-card').count(), manifest.methods.length);
    assert.equal(await card(initial).getAttribute('class'), 'method-card selected');
    assert.deepEqual(await page.locator('.method-mark').allTextContents(), manifest.methods.map((method,index)=>method.mark || String.fromCharCode(65+index)));
    if (manifest.subtitle) assert.equal(await page.locator('#page-subtitle').textContent(), manifest.subtitle);
    if (manifest.reference_url) assert.equal(await page.locator('#reference-link').getAttribute('href'), new URL(manifest.reference_url, url).href);
    const position = Math.min(3, findClip(initial).duration*.25);
    await audio(initial).evaluate(a=>a.play());
    await page.waitForFunction(() => document.querySelector('.selected audio').currentTime>.15);
    await audio(initial).evaluate((a,seconds)=>{a.currentTime=seconds;}, position);
    await select(first).click();
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].filter(a=>!a.paused).length===1 && !document.querySelector('.selected audio').paused);
    assert.ok(await audio(first).evaluate((a,seconds)=>a.currentTime>=seconds && a.currentTime<seconds+1, position));
    report.checks.push('Real PCM24 WAV playback; method switch retains time; only one audio plays');
    await audio(first).evaluate(a=>a.pause());
    await select(second).click();
    assert.ok(await audio(second).evaluate((a,seconds)=>a.paused && a.currentTime>=seconds, position));
    report.checks.push('Paused method switch stays paused');
    const alternateMode = manifest.modes.find(mode=>mode.id!==defaults.mode.id) || defaults.mode;
    await page.getByRole('button', { name: alternateMode.label, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.selected audio').readyState>=2);
    assert.ok(await audio(second).evaluate((a,seconds)=>a.currentTime>=seconds && a.paused, position));
    report.checks.push('Loudness mode retains playback position');
    if (manifest.scenes.some(scene=>scene.id==='tour')) {
      await page.locator('#scene-select').selectOption('tour');
      const chapters = manifest.scenes.filter(scene=>scene.id!=='tour');
      assert.equal(await page.locator('#chapters button').count(), chapters.length);
      for (let index=0, start=0; index<chapters.length; index++) {
        await page.locator('#chapters button').nth(index).click();
        await page.waitForFunction(()=>document.querySelector('.selected audio').readyState>=1);
        assert.ok(await audio(second).evaluate((a,seconds)=>Math.abs(a.currentTime-seconds)<.02, start));
        start += findClip(second, chapters[index].id, alternateMode.id).duration + .6;
      }
      report.checks.push(`All ${chapters.length} tour chapters seek to measured boundaries`);
    }
    for (const source of manifest.sources) {
      await page.getByRole('button', { name: source.label, exact: true }).click();
      for (const scene of manifest.scenes) {
        await page.locator('#scene-select').selectOption(scene.id);
        for (const mode of manifest.modes) {
          await page.getByRole('button', { name: mode.label, exact: true }).click();
          await page.waitForFunction(() => [...document.querySelectorAll('audio')].every(a=>a.readyState>=1 && !a.error));
          const actual = await page.locator('audio').evaluateAll(nodes=>nodes.map(a=>({src:a.getAttribute('src'),duration:a.duration})));
          const expected = manifest.clips.filter(c=>c.source===source.id && c.scene===scene.id && c.mode===mode.id);
          assert.equal(actual.length, expected.length);
          for (const a of actual) {
            const match = expected.find(c=>c.file===a.src);
            assert.ok(match);
            assert.ok(Math.abs(match.duration-a.duration)<.002);
            report.metadataFiles++;
          }
        }
      }
    }
    assert.equal(report.metadataFiles, manifest.clips.length);
    report.checks.push(`All ${report.metadataFiles} source/method/scene/mode WAVs load with correct durations`);
    await page.getByRole('button', { name: defaults.source.label, exact: true }).click();
    await page.locator('#scene-select').selectOption(defaults.scene.id);
    await page.getByRole('button', { name: defaults.mode.label, exact: true }).click();
    await select(initial).click();
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].every(a=>a.readyState>=2));
    assert.ok(await audio(initial).evaluate(a=>a.paused));
    if (manifest.sources.length>1 || manifest.scenes.length>1) {
      assert.ok(await audio(initial).evaluate(a=>a.currentTime===0));
    } else {
      // A singleton source/scene never changes, so setting it again correctly
      // preserves the time. Explicitly seek for the download/screenshot setup.
      await audio(initial).evaluate(a=>{a.currentTime=0;});
    }
    if (defaults.method.trajectory) {
      const tr = defaults.method.trajectory;
      await page.locator('#motion-details summary').click();
      for (const [angle, direction] of [[90,'左侧'],[180,'后方'],[270,'右侧'],[360,'前方'],[450,'左侧']]) {
        const upper = tr.azimuth_unwrapped_deg.findIndex(value=>value>=angle);
        assert.ok(upper>=0);
        const lower = Math.max(0,upper-1);
        const span = tr.azimuth_unwrapped_deg[upper]-tr.azimuth_unwrapped_deg[lower];
        const fraction = span ? (angle-tr.azimuth_unwrapped_deg[lower])/span : 0;
        const seconds = tr.times_s[lower]+fraction*(tr.times_s[upper]-tr.times_s[lower]);
        await audio(initial).evaluate((a,seconds)=>{a.currentTime=seconds;},seconds);
        await page.waitForFunction(expected=>document.querySelector('#motion-position').textContent.startsWith(expected+' ·'),direction);
      }
      await audio(initial).evaluate(a=>{a.currentTime=a.duration-.1;});
      await page.waitForFunction(()=>document.querySelector('#motion-position').textContent.startsWith('左侧 ·'));
      const endDistance = tr.distance_m.at(-1).toFixed(2);
      assert.ok((await page.locator('#motion-position').textContent()).includes(endDistance+' 米'));
      await page.locator('#motion-details summary').click();
      await audio(initial).evaluate(a=>{a.currentTime=0;});
      report.checks.push('Preset position follows left/back/right/front/left and holds its endpoint during tail');
    }
    if (manifest.transcript) {
      await page.locator('#transcript-details summary').click();
      assert.equal(await page.locator('#transcript').textContent(),manifest.transcript);
      await page.locator('#transcript-details summary').click();
      report.checks.push('Full long-form transcript is available in the disclosure');
    }
    const downloadEvent = page.waitForEvent('download');
    await card(initial).getByRole('link', { name: '下载 WAV', exact: true }).click();
    const download = await downloadEvent;
    const downloadPath = await download.path();
    const hash = crypto.createHash('sha256').update(await fs.readFile(downloadPath)).digest('hex');
    assert.equal(hash, findClip(initial).sha256);
    report.checks.push('Downloaded WAV hash matches rendered asset');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({ path: path.join(out, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true });
    report.checks.push('1280px and 390px layouts have no horizontal overflow');
    const offline = await context.newPage();
    offline.on('pageerror', e => report.errors.push(String(e)));
    offline.on('console', msg => { if (msg.type() === 'error') report.errors.push(msg.text()); });
    await offline.goto(pathToFileURL(path.resolve(out,'index.html')).href);
    await offline.waitForFunction(()=>[...document.querySelectorAll('audio')].every(a=>a.readyState>=2));
    await offline.locator('.selected audio').evaluate(a=>a.play());
    await offline.waitForFunction(()=>document.querySelector('.selected audio').currentTime>.1);
    await offline.locator('.selected audio').evaluate(a=>a.pause());
    report.checks.push('Standalone file:// page also plays WAVs');
    assert.deepEqual(report.errors, []);
    report.status = 'passed';
  } finally {
    await fs.writeFile(path.join(out, 'browser-verification.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify(report, null, 2));
})().catch(error=>{console.error(error);process.exitCode=1;});
