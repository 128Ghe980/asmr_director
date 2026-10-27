/* Register the two approved Japanese references through the product storage API.
 * No model, ASR, FFmpeg, pitch, gain, or sample-rate operation runs here.
 * Usage: D:/nodejs/node.exe tools/voxcpm2-runtime/register_japanese_references.cjs [--apply]
 * With no --apply, write only a bounded preflight/manifest in the handoff QA folder.
 * --apply is resumable: it reuses an exact existing input+transcript+label match.
 */
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../..');
const APP = path.join(ROOT, 'apps/web');
const FOLLOWUP = 'I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27';
const QA = 'I:/AI/asmr_director/qa/handoff/2026-10-28/japanese-references/registration';
const PROFILE = 'D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/voxcpm2/profile.json';
const DESTINATION = 'I:/AI/asmr_director/runtime/voice-references';
const apply = process.argv.includes('--apply');
assert(process.argv.slice(2).every(arg => arg === '--apply'), 'Only --apply is accepted');

// Transpile product TypeScript in memory with the installed project compiler.
// The hook applies only to this app's source tree; no generated JS is written.
const ts = require(path.join(APP, 'node_modules/typescript'));
const previousTs = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  assert(filename.startsWith(path.join(APP, 'src') + path.sep), `Unexpected TS dependency: ${filename}`);
  const source = syncFs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  }, fileName: filename }).outputText;
  module._compile(compiled, filename);
};
const importer = require(path.join(APP, 'src/lib/asmr/voice-reference-import.ts'));
const profiles = require(path.join(APP, 'src/lib/asmr/voxcpm2-profile.ts'));
const { getLocalRuntimeConfig } = require(path.join(APP, 'src/lib/asmr/local-runtime-config.ts'));
const config = getLocalRuntimeConfig({ ASMR_VOXCPM2_PROFILE_PATH: PROFILE, ASMR_VOICE_REFERENCE_ROOT: DESTINATION });

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
async function identity(file) {
  const buffer = await fs.readFile(file);
  return { path: path.resolve(file), bytes: buffer.length, sha256: sha(buffer) };
}
async function matchesIdentity(expected) {
  const current = await identity(expected.path);
  assert.equal(current.bytes, expected.bytes, `Size changed: ${expected.path}`);
  assert.equal(current.sha256, expected.sha256, `Hash changed: ${expected.path}`);
  return current;
}
async function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await fs.rename(temporary, file);
}
async function copyExact(source, destination, expectedSha) {
  const bytes = await fs.readFile(source);
  assert.equal(sha(bytes), expectedSha);
  try { await fs.writeFile(destination, bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  assert.equal((await identity(destination)).sha256, expectedSha, `Existing destination differs: ${destination}`);
  return identity(destination);
}
function wavFormat(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  let fmt, data;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4);
    assert(offset + 8 + size <= bytes.length);
    if (kind === 'fmt ') fmt = { format_tag: bytes.readUInt16LE(offset + 8), channels: bytes.readUInt16LE(offset + 10), sample_rate: bytes.readUInt32LE(offset + 12), block_align: bytes.readUInt16LE(offset + 20), bits_per_sample: bytes.readUInt16LE(offset + 22) };
    if (kind === 'data') data = bytes.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + size % 2;
  }
  assert(fmt && data);
  return { ...fmt, frames: data.length / fmt.block_align, duration_seconds: data.length / fmt.block_align / fmt.sample_rate };
}
async function treeIdentities(directory) {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await treeIdentities(file));
    else if (entry.isFile()) output.push(await identity(file));
  }
  return output;
}
function defaults(seed) { return { referenceMode: 'with_reference_text', cfg: 2.5, timesteps: 10, seed }; }

async function buildManifest() {
  const variants = await json(path.join(FOLLOWUP, 'reference-refinement/reference-variants.json'));
  const snow = variants.references.find(item => item.id === 'yukino25-gain-minus6');
  const snowPrep = await json(path.join(FOLLOWUP, 'yukino-length/preparation.json'));
  const yui = await json(path.join(FOLLOWUP, 'yui-reference-02/preparation.json'));
  const inputs = [
    { key: 'yukino-25p10s-minus6-ja-v1', displayName: '雪之下', seed: 43, model: snow.model, preview: snow.source_preview,
      source: snowPrep.source, sourceSelection: { start_seconds: 0, duration_seconds: 25.1, full_original_file: false },
      gain: { final_static_gain_db: -6, prior_model_initial_gain_db: -1.0700021698755942, already_applied: true, additional_gain_db: 0 },
      manifestPath: path.join(FOLLOWUP, 'parameter-sweep/guarded-yukino-cfg2p5-step10.json'), expectedSha: '9819886cfaac52273dbf3aec2a4b008691b36c7af5e196df5139e1fcf863bd3f', frames: 401600 },
    { key: 'yui-reference02-ja-v1', displayName: '由比滨', seed: 42, model: yui.model, preview: yui.source_preview,
      source: yui.source, sourceSelection: { start_seconds: 0, decoded_frames: 891648, sample_rate: 44100, full_original_file: true },
      gain: { static_gain_linear: 1, static_gain_db: 0, additional_gain_db: 0 },
      manifestPath: path.join(FOLLOWUP, 'yui-reference-02/guarded-yui-reference-02.json'), expectedSha: 'a1440c9b9184286a683ed9612f9b2b34fcb171f2fda525e8505b37fe33609ecb', frames: 323501 },
  ];
  for (const item of inputs) {
    const evidence = await json(item.manifestPath), ref = evidence.references[0];
    assert.equal(evidence.references.length, 1);
    assert.equal(path.resolve(ref.path), path.resolve(item.model.path));
    assert.equal(ref.mode, 'combined');
    assert.equal(evidence.cfg, 2.5); assert.equal(evidence.timesteps, 10); assert.equal(evidence.seed, item.seed);
    assert.equal(item.model.sha256, item.expectedSha);
    await matchesIdentity(item.model); await matchesIdentity(item.preview); await matchesIdentity(item.source);
    item.format = wavFormat(await fs.readFile(item.model.path));
    assert.deepEqual(item.format, { format_tag: 1, channels: 1, sample_rate: 16000, block_align: 2, bits_per_sample: 16, frames: item.frames, duration_seconds: item.frames / 16000 });
    assert.equal(importer.validateVoiceReferenceAudio(await fs.readFile(item.model.path), item.frames / 16000), item.frames / 16000);
    item.previewFormat = wavFormat(await fs.readFile(item.preview.path));
    item.language = 'ja'; item.generationDefaults = defaults(item.seed); item.promptText = ref.promptText;
    item.testedManifest = await identity(item.manifestPath);
    delete item.manifestPath; delete item.expectedSha; delete item.frames; delete item.seed;
  }
  return { version: 1, purpose: 'Approved Japanese reference library registration', profilePath: PROFILE, destinationRoot: DESTINATION,
    productStorageEntryPoint: 'apps/web/src/lib/asmr/voice-reference-import.ts#importVoiceReference',
    bytePreservingAdapter: 'Existing spawnImpl dependency validates exact complete prepared PCM16 then copies its bytes; no native child or conversion runs.',
    nativeModeEquivalent: 'combined', languageUse: 'Japanese target speech; Chinese voice likeness was not accepted.',
    defaultReferenceIdPolicy: 'Preserve existing profile default and all prior references.', inputs };
}

async function findExisting(item) {
  const profile = profiles.parseVoxCpm2ProfileFile(await json(PROFILE));
  const found = [];
  for (const ref of profile.references) {
    const audio = await identity(path.resolve(path.dirname(PROFILE), ref.audioPath));
    if (audio.sha256 !== item.model.sha256) continue;
    const prompt = ref.promptTextPath ? (await fs.readFile(path.resolve(path.dirname(PROFILE), ref.promptTextPath), 'utf8')).trim() : null;
    assert.equal(ref.displayName, item.displayName, 'Same audio has a different registered name; do not duplicate or overwrite it.');
    assert.equal(prompt, item.promptText, 'Same audio has a different transcript; do not duplicate or overwrite it.');
    assert(path.resolve(ref.audioPath).startsWith(path.resolve(DESTINATION) + path.sep), 'Existing input must already be in formal runtime storage');
    found.push(ref);
  }
  assert(found.length <= 1, `Duplicate exact references: ${item.key}`);
  return found[0];
}

function exactPcmCopyAdapter(item, events) {
  return (_command, args, options) => {
    const child = new EventEmitter(); child.stderr = null; child.kill = () => false;
    const source = args[args.indexOf('-i') + 1], destination = args.at(-1);
    queueMicrotask(async () => {
      try {
        assert.equal(args[args.indexOf('-ss') + 1], '0');
        assert.equal(Number(args[args.indexOf('-t') + 1]), item.format.duration_seconds);
        assert.equal(path.dirname(destination), options.cwd);
        const input = await fs.readFile(source);
        assert.equal(sha(input), item.model.sha256);
        assert.deepEqual(wavFormat(input), item.format);
        importer.validateVoiceReferenceAudio(input, item.format.duration_seconds);
        await copyExact(source, destination, item.model.sha256);
        events.push({ operation: 'byte-preserving prepared PCM copy', source, destination, sha256: item.model.sha256, native_process_started: false, conversion_arguments_not_executed: args });
        child.emit('close', 0);
      } catch (error) { events.push({ error: String(error) }); child.emit('error', error); }
    });
    return child;
  };
}

async function appendMetadata(id, item, previewPath) {
  const lockPath = `${PROFILE}.reference-import.lock`, deadline = Date.now() + 10000;
  let lock;
  while (!lock) {
    try { lock = await fs.open(lockPath, 'wx'); }
    catch (error) { if (error.code !== 'EEXIST' || Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 40)); }
  }
  try {
    const original = await fs.readFile(PROFILE, 'utf8'), file = profiles.parseVoxCpm2ProfileFile(JSON.parse(original));
    const ref = file.references.find(row => row.id === id); assert(ref);
    const next = { ...ref, language: item.language, generationDefaults: item.generationDefaults, previewAudioPath: previewPath, referenceImportKey: item.key };
    if (JSON.stringify(ref) === JSON.stringify(next)) return { changed: false };
    const updated = profiles.parseVoxCpm2ProfileFile({ ...file, references: file.references.map(row => row.id === id ? next : row) });
    const backup = `${PROFILE}.before-japanese-settings-${id}-${randomUUID()}.bak`;
    await fs.writeFile(backup, original, { flag: 'wx' });
    await atomicJson(PROFILE, updated);
    return { changed: true, backup: await identity(backup) };
  } finally { await lock.close(); await fs.unlink(lockPath); }
}

async function main() {
  await fs.mkdir(QA, { recursive: true });
  const manifest = await buildManifest();
  await atomicJson(path.join(QA, 'manifest.json'), manifest);
  const profileBefore = profiles.parseVoxCpm2ProfileFile(await json(PROFILE));
  const existing = [];
  for (const input of manifest.inputs) existing.push({ key: input.key, existingId: (await findExisting(input))?.id ?? null });
  await atomicJson(path.join(QA, 'preflight.json'), { timestamp: new Date().toISOString(), status: 'passed', applyRequested: apply, profile: await identity(PROFILE), referenceCount: profileBefore.references.length, defaultReferenceId: profileBefore.defaultReferenceId, existing });
  if (!apply) { console.log(JSON.stringify({ status: 'preflight_passed', existing, manifest: path.join(QA, 'manifest.json') })); return; }
  const beforePath = path.join(QA, 'before.json');
  let before;
  try { before = await json(beforePath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const oldFiles = await treeIdentities(DESTINATION);
    for (const ref of profileBefore.references) for (const key of ['audioPath', 'promptTextPath', 'provenancePath']) {
      if (ref[key]) { const file = path.resolve(path.dirname(PROFILE), ref[key]); if (!oldFiles.some(row => path.resolve(row.path) === file)) oldFiles.push(await identity(file)); }
    }
    const backup = path.join(QA, 'profile-before.json');
    await fs.writeFile(backup, await fs.readFile(PROFILE), { flag: 'wx' });
    before = { timestamp: new Date().toISOString(), profile: await identity(PROFILE), profileSnapshot: await identity(backup), profileData: profileBefore, oldFiles };
    await fs.writeFile(beforePath, JSON.stringify(before, null, 2) + '\n', { flag: 'wx' });
  }
  const imports = [], copyEvents = [];
  for (const item of manifest.inputs) {
    let reference = await findExisting(item), result = null;
    const reused = Boolean(reference);
    if (!reference) {
      result = await importer.importVoiceReference({ bytes: await fs.readFile(item.model.path), filename: `${item.key}.wav`, name: item.displayName, promptText: item.promptText, startSeconds: 0, durationSeconds: item.format.duration_seconds, config }, { spawnImpl: exactPcmCopyAdapter(item, copyEvents) });
      reference = (await json(PROFILE)).references.find(ref => ref.id === result.id); assert(reference);
    }
    const directory = path.dirname(reference.audioPath), previewPath = path.join(directory, 'source-preview.wav');
    const preview = await copyExact(item.preview.path, previewPath, item.preview.sha256);
    const metadataWrite = await appendMetadata(reference.id, item, previewPath);
    const provenance = await json(reference.provenancePath);
    const enriched = { ...provenance, bytePreservingImport: true, normalizationPerformed: false,
      language: item.language, generationDefaults: item.generationDefaults, referenceImportKey: item.key,
      originalUserSource: item.source, originalSourceSelection: item.sourceSelection, testedModelInput: item.model,
      sourcePreview: preview, testedSourcePreview: item.preview, gain: item.gain, testedManifest: item.testedManifest,
      languageUse: manifest.languageUse, registrationManifest: path.join(QA, 'manifest.json') };
    await atomicJson(reference.provenancePath, enriched);
    const registration = { key: item.key, id: reference.id, displayName: item.displayName, language: item.language,
      generationDefaults: item.generationDefaults, promptText: item.promptText, modelInput: await identity(reference.audioPath),
      sourceCopy: await identity(path.join(directory, 'source.wav')), transcript: await identity(reference.promptTextPath),
      preview, format: item.format, previewFormat: item.previewFormat, source: item.source, sourceSelection: item.sourceSelection,
      gain: item.gain, provenance: await identity(reference.provenancePath), testedManifest: item.testedManifest };
    await atomicJson(path.join(directory, 'registration.json'), registration);
    imports.push({ ...registration, reused, result, metadataWrite, registration: await identity(path.join(directory, 'registration.json')) });
    await atomicJson(path.join(QA, 'import-progress.json'), { status: 'in_progress', imports, copyEvents });
  }
  const after = profiles.parseVoxCpm2ProfileFile(await json(PROFILE));
  assert.equal(after.defaultReferenceId, before.profileData.defaultReferenceId);
  for (const old of before.profileData.references) assert.deepEqual(after.references.find(row => row.id === old.id), old);
  assert.deepEqual({ ...after, references: [] }, { ...before.profileData, references: [] });
  assert.equal(after.references.length, before.profileData.references.length + 2);
  const loaded = await profiles.loadVoxCpm2Profile(PROFILE), verified = [];
  for (let index = 0; index < manifest.inputs.length; index++) {
    const item = manifest.inputs[index], row = imports[index], loadedRef = loaded.references.find(ref => ref.id === row.id);
    assert(loadedRef); assert.equal(loadedRef.language, 'ja'); assert.deepEqual(loadedRef.generationDefaults, item.generationDefaults);
    assert.equal(loadedRef.promptText, item.promptText);
    assert.equal(sha(await importer.readVoiceReferenceAudio(row.id, config)), item.model.sha256);
    assert.equal((await identity(loadedRef.audioPath)).sha256, item.model.sha256);
    assert.deepEqual(wavFormat(await fs.readFile(loadedRef.audioPath)), item.format);
    for (const entry of [item.source, item.model, item.preview, item.testedManifest]) await matchesIdentity(entry);
    verified.push({ id: row.id, byteExactModelInput: true, fullDurationPreserved: true, promptExactIncludingPunctuation: true,
      language: loadedRef.language, generationDefaults: loadedRef.generationDefaults, productAudioReadSha256: item.model.sha256 });
  }
  for (const old of before.oldFiles) await matchesIdentity(old);
  const receipt = { version: 1, status: 'passed', timestamp: new Date().toISOString(), script: await identity(__filename),
    manifest: await identity(path.join(QA, 'manifest.json')), profileBefore: before.profile, profileAfter: await identity(PROFILE),
    profileSnapshot: before.profileSnapshot, defaultReferenceIdUnchanged: after.defaultReferenceId,
    oldReferencesUnchanged: before.profileData.references.length, oldAssetHashesPreserved: before.oldFiles.length,
    expectedFinalReferenceCount: after.references.length, imports, verified, copyEvents,
    actualNativeProcessesStarted: 0, modelsOrAsrRun: false, inputAudioChanged: false,
    recovery: 'Rerun --apply to resume without duplicating an exact audio/transcript/name match. Profile append and metadata writes each retain immutable backups. profile-before.json is the pre-registration snapshot; do not restore it over later unrelated library changes.',
    acceptanceScope: 'Stored Japanese language, exact approved inputs/transcripts and per-reference settings verified; this registration does not establish Chinese timbre quality or run fresh synthesis.' };
  await atomicJson(path.join(QA, 'registration-receipt.json'), receipt);
  await atomicJson(path.join(QA, 'import-progress.json'), { status: 'complete', receipt: await identity(path.join(QA, 'registration-receipt.json')) });
  console.log(JSON.stringify({ status: receipt.status, imports: imports.map(row => ({ id: row.id, name: row.displayName, path: row.modelInput.path, sha256: row.modelInput.sha256 })), receipt: path.join(QA, 'registration-receipt.json') }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (previousTs) require.extensions['.ts'] = previousTs; else delete require.extensions['.ts'];
});
