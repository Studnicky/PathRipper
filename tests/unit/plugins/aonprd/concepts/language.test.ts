// Unit tests for language concept capability nodes (Phase 6.3).
// Tests each of the 5 capability nodes in isolation against the two language
// HTML fixtures (language-common.html and language-osiriani.html).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CheerioAPI } from 'cheerio';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  languageBaseNode,
  languageSpeakersNode,
  languagePfsNoteNode,
  languageDescriptionNode,
  finalizeLanguageNode,
} from '../../../../../plugins/aonprd/concepts/language.js';
import type {
  LanguageOutput,
  LanguageSpeakers,
  SpeakerRef,
} from '../../../../../plugins/aonprd/concepts/language.js';
import type { CommonExtraction, Section } from '../../../../../plugins/aonprd/common.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

// ─── Helper: prime state through the full prerequisite chain ──────────────────

async function primeState(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);

  // Run all prerequisite nodes in order (mirrors the taxonomy chain for thing → language)
  const r1 = await loadAndCommonNode.execute(state, stubContext);
  assert.equal(r1.output, 'success', `loadAndCommon failed for ${fixtureName}`);

  const r2 = await labelPairBlockNode.execute(state, stubContext);
  assert.equal(r2.output, 'success', `labelPairBlock failed for ${fixtureName}`);

  const r3 = await sectionWalkerNode.execute(state, stubContext);
  assert.equal(r3.output, 'success', `sectionWalker failed for ${fixtureName}`);

  const r4 = await sourceRefNode.execute(state, stubContext);
  assert.equal(r4.output, 'success', `sourceRef failed for ${fixtureName}`);

  return state;
}

async function primeAndRunFull(fixtureName: string, url: string) {
  const state = await primeState(fixtureName, url);

  const r5 = await languageBaseNode.execute(state, stubContext);
  assert.equal(r5.output, 'success', `languageBase failed for ${fixtureName}`);

  const r6 = await languageDescriptionNode.execute(state, stubContext);
  assert.equal(r6.output, 'success', `languageDescription failed for ${fixtureName}`);

  const r7 = await languageSpeakersNode.execute(state, stubContext);
  assert.equal(r7.output, 'success', `languageSpeakers failed for ${fixtureName}`);

  const r8 = await languagePfsNoteNode.execute(state, stubContext);
  assert.equal(r8.output, 'success', `languagePfsNote failed for ${fixtureName}`);

  const r9 = await finalizeLanguageNode.execute(state, stubContext);
  assert.equal(r9.output, 'success', `finalizeLanguage failed for ${fixtureName}`);

  return state.output as LanguageOutput;
}

// ─── extract:language-base ────────────────────────────────────────────────────

describe('extract:language-base — language-common', () => {
  it('produces _type, name, url, rarity, legacy flag', async () => {
    const state = await primeState('language-common.html', 'https://2e.aonprd.com/Languages.aspx?ID=1');
    const r = await languageBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as LanguageOutput;
    assert.equal(out._type, 'language');
    assert.equal(out.name, 'Common');
    assert.equal(out.rarity, 'common');
    assert.equal(out.legacy, true, 'Common fixture has legacy-content-warning');
    assert.equal(out.language_id, 1);
  });

  it('source is populated', async () => {
    const state = await primeState('language-common.html', 'https://2e.aonprd.com/Languages.aspx?ID=1');
    await languageBaseNode.execute(state, stubContext);
    const out = state.output as LanguageOutput;
    assert.ok(out.source.book !== null, 'source.book should be non-null');
    assert.ok(out.sources.length > 0, 'sources array should be non-empty');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Languages.aspx?ID=1');
    const r = await languageBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:language-base — language-osiriani', () => {
  it('produces name "Osiriani" without legacy flag', async () => {
    const state = await primeState('language-osiriani.html', 'https://2e.aonprd.com/Languages.aspx?ID=36');
    const r = await languageBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as LanguageOutput;
    assert.equal(out.name, 'Osiriani');
    assert.equal(out.legacy, false, 'Osiriani fixture has no legacy-content-warning');
    assert.equal(out.language_id, 36);
  });
});

// ─── extract:language-speakers ───────────────────────────────────────────────

describe('extract:language-speakers — language-common', () => {
  it('populates speakers.ancestries from the Ancestries section', async () => {
    const state = await primeState('language-common.html', 'https://2e.aonprd.com/Languages.aspx?ID=1');
    await languageBaseNode.execute(state, stubContext);
    const r = await languageSpeakersNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as LanguageOutput;
    assert.ok(out.speakers !== undefined, 'speakers field missing');
    assert.ok(out.speakers.ancestries.length > 0, 'ancestries bucket should be non-empty for Common');
    // Common has 48 ancestries per fixture heading
    assert.ok(out.speakers.ancestries.length >= 40, `expected ≥40 ancestry refs, got ${out.speakers.ancestries.length}`);
  });

  it('populates section_counts from heading annotations', async () => {
    const state = await primeState('language-common.html', 'https://2e.aonprd.com/Languages.aspx?ID=1');
    await languageBaseNode.execute(state, stubContext);
    await languageSpeakersNode.execute(state, stubContext);

    const out = state.output as LanguageOutput;
    assert.ok(typeof out.section_counts === 'object', 'section_counts missing');
    // Ancestries (48) heading
    assert.ok('ancestries' in out.section_counts, 'section_counts missing ancestries key');
    assert.equal(out.section_counts['ancestries'], 48);
  });

  it('speaker refs have name, aon_id, kind, href', async () => {
    const state = await primeState('language-common.html', 'https://2e.aonprd.com/Languages.aspx?ID=1');
    await languageBaseNode.execute(state, stubContext);
    await languageSpeakersNode.execute(state, stubContext);

    const out = state.output as LanguageOutput;
    const first = out.speakers.ancestries[0];
    assert.ok(first !== undefined, 'no ancestry refs');
    assert.ok(typeof first.name === 'string' && first.name.length > 0, 'name missing');
    assert.ok(typeof first.aon_id === 'number', 'aon_id should be a number for Ancestries links');
    assert.equal(first.kind, 'ancestry');
    assert.ok(typeof first.href === 'string' && first.href.length > 0, 'href missing');
  });

  it('populates creatures bucket from Creatures section', async () => {
    const state = await primeState('language-common.html', 'https://2e.aonprd.com/Languages.aspx?ID=1');
    await languageBaseNode.execute(state, stubContext);
    await languageSpeakersNode.execute(state, stubContext);

    const out = state.output as LanguageOutput;
    assert.ok(out.speakers.creatures.length > 0, 'creatures bucket should be non-empty for Common');
  });

  it('error path — returns error when sections metadata missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Languages.aspx?ID=1');
    const r = await languageSpeakersNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:language-speakers — language-osiriani', () => {
  it('populates creatures bucket from Creatures (40) section', async () => {
    const state = await primeState('language-osiriani.html', 'https://2e.aonprd.com/Languages.aspx?ID=36');
    await languageBaseNode.execute(state, stubContext);
    await languageSpeakersNode.execute(state, stubContext);

    const out = state.output as LanguageOutput;
    assert.ok(out.speakers.creatures.length > 0, 'creatures bucket should be non-empty for Osiriani');
    assert.equal(out.section_counts['creatures'], 40, 'section_counts.creatures should be 40');
  });

  it('ancestries bucket is empty (Osiriani has no Ancestries section)', async () => {
    const state = await primeState('language-osiriani.html', 'https://2e.aonprd.com/Languages.aspx?ID=36');
    await languageBaseNode.execute(state, stubContext);
    await languageSpeakersNode.execute(state, stubContext);

    const out = state.output as LanguageOutput;
    assert.equal(out.speakers.ancestries.length, 0, 'Osiriani has no Ancestries section');
  });
});

// ─── extract:language-pfs-note ────────────────────────────────────────────────

describe('extract:language-pfs-note — language-osiriani (has PFS Note)', () => {
  it('extracts pfs_note text', async () => {
    const state = await primeState('language-osiriani.html', 'https://2e.aonprd.com/Languages.aspx?ID=36');
    const r = await languagePfsNoteNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as LanguageOutput;
    assert.ok(out.pfs_note !== null && out.pfs_note !== undefined, 'pfs_note should be non-null for Osiriani');
    assert.ok(out.pfs_note!.length > 0, 'pfs_note should be non-empty string');
    assert.ok(
      out.pfs_note!.toLowerCase().includes('absalom'),
      `expected pfs_note to mention Absalom, got: "${out.pfs_note}"`,
    );
  });

  it('error path — returns error when cheerio metadata missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Languages.aspx?ID=36');
    const r = await languagePfsNoteNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:language-pfs-note — language-common (no PFS Note)', () => {
  it('produces pfs_note: null', async () => {
    const state = await primeState('language-common.html', 'https://2e.aonprd.com/Languages.aspx?ID=1');
    const r = await languagePfsNoteNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as LanguageOutput;
    assert.equal(out.pfs_note, null, 'Common language has no PFS Note');
  });
});

// ─── extract:language-description ────────────────────────────────────────────

describe('extract:language-description — language-common', () => {
  it('produces description_text containing "Common"', async () => {
    const state = await primeState('language-common.html', 'https://2e.aonprd.com/Languages.aspx?ID=1');
    await languageBaseNode.execute(state, stubContext);
    const r = await languageDescriptionNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as LanguageOutput;
    assert.ok(out.description_text.length > 0, 'description_text should be non-empty');
    assert.ok(
      out.description_text.includes('Common'),
      `expected description_text to reference "Common", got: "${out.description_text}"`,
    );
  });

  it('filters legacy-content-warning from sections[]', async () => {
    const state = await primeState('language-common.html', 'https://2e.aonprd.com/Languages.aspx?ID=1');
    await languageBaseNode.execute(state, stubContext);
    await languageDescriptionNode.execute(state, stubContext);

    const out = state.output as LanguageOutput;
    // Legacy Content heading must not appear in filtered sections
    const legacySection = out.sections.find((s) =>
      /legacy[\s-]content[\s-]warning/i.test(s.heading),
    );
    assert.equal(legacySection, undefined, 'legacy-content-warning section should be filtered');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Languages.aspx?ID=1');
    const r = await languageDescriptionNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

// ─── finalize:language ────────────────────────────────────────────────────────

describe('finalize:language — language-common', () => {
  it('produces raw_fields, links, body_text, body_html, meta fields', async () => {
    const state = await primeState('language-common.html', 'https://2e.aonprd.com/Languages.aspx?ID=1');
    await languageBaseNode.execute(state, stubContext);
    await languageDescriptionNode.execute(state, stubContext);
    await languageSpeakersNode.execute(state, stubContext);
    await languagePfsNoteNode.execute(state, stubContext);
    const r = await finalizeLanguageNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as LanguageOutput;
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
    assert.ok(typeof out.body_html === 'string', 'body_html missing');
    // meta_keywords should be present — Common fixture has the keywords tag
    assert.ok(out.meta_keywords !== undefined, 'meta_keywords missing');
  });

  it('raw_fields does not contain claimed keys (Source, Type, Kind, Script, Speakers)', async () => {
    const state = await primeState('language-common.html', 'https://2e.aonprd.com/Languages.aspx?ID=1');
    await languageBaseNode.execute(state, stubContext);
    await languageDescriptionNode.execute(state, stubContext);
    await languageSpeakersNode.execute(state, stubContext);
    await languagePfsNoteNode.execute(state, stubContext);
    await finalizeLanguageNode.execute(state, stubContext);

    const out = state.output as LanguageOutput;
    const claimedLower = new Set(['source', 'type', 'kind', 'script', 'speakers']);
    for (const key of Object.keys(out.raw_fields)) {
      assert.ok(
        !claimedLower.has(key.toLowerCase()),
        `claimed key "${key}" should be absent from raw_fields`,
      );
    }
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Languages.aspx?ID=1');
    const r = await finalizeLanguageNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

// ─── Full pipeline integration (common) ──────────────────────────────────────

describe('full language pipeline — language-common', () => {
  it('produces a complete LanguageOutput with all required fields', async () => {
    const out = await primeAndRunFull('language-common.html', 'https://2e.aonprd.com/Languages.aspx?ID=1');

    assert.equal(out._type, 'language');
    assert.equal(out.name, 'Common');
    assert.ok(out.speakers !== undefined, 'speakers missing');
    assert.ok(typeof out.section_counts === 'object', 'section_counts missing');
    assert.equal(out.pfs_note, null, 'Common has no PFS Note');
    assert.ok(out.description_text.length > 0, 'description_text missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
  });

  it('has no typical_speakers field (Wave 5 deprecated field)', async () => {
    const out = await primeAndRunFull('language-common.html', 'https://2e.aonprd.com/Languages.aspx?ID=1');
    assert.ok(!('typical_speakers' in out), 'typical_speakers should be absent — deprecated in Wave 6');
  });
});

// ─── Full pipeline integration (osiriani) ────────────────────────────────────

describe('full language pipeline — language-osiriani', () => {
  it('produces a complete LanguageOutput with PFS Note', async () => {
    const out = await primeAndRunFull('language-osiriani.html', 'https://2e.aonprd.com/Languages.aspx?ID=36');

    assert.equal(out._type, 'language');
    assert.equal(out.name, 'Osiriani');
    assert.ok(out.pfs_note !== null, 'Osiriani should have pfs_note');
    assert.ok(out.speakers.creatures.length > 0, 'creatures bucket should be populated');
    assert.equal(out.speakers.ancestries.length, 0, 'Osiriani has no ancestries section');
    assert.equal(out.section_counts['creatures'], 40);
  });
});
