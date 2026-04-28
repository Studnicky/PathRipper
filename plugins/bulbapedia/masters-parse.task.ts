import wtf from 'wtf_wikipedia';
import { TaskRegistry } from '../../src/registry/TaskRegistry.js';
import type { PipelineStateInterface } from '../../src/registry/PipelineState.js';
import type { TaskFnType } from '../../src/pipeline/Pipeline.js';

const MASTERS_INFOBOX_TEMPLATE = 'mastersinfobox';

const INFOBOX_FIELDS = [
  'name', 'jname', 'jtrans', 'type', 'num', 'image', 'desc',
  'enva', 'java', 'caption',
] as const;

const task: TaskFnType<PipelineStateInterface> = async (next, state) => {
  const { title, wikitext } = state.page;
  if (!wikitext) { await next(); return; }

  const doc = wtf(wikitext);

  // wtf_wikipedia parses MastersInfobox as a generic template, not an infobox.
  // Find it by the normalized template name.
  const templates = doc.templates();
  const raw = templates.find(
    (t) => (t.json() as Record<string, unknown>)['template'] === MASTERS_INFOBOX_TEMPLATE,
  );

  const rawData = raw !== undefined ? (raw.json() as Record<string, string | undefined>) : {};

  const infobox: Record<string, string | null> = {};
  for (const f of INFOBOX_FIELDS) {
    const val = rawData[f];
    infobox[f] = val !== undefined && val !== '' ? val : null;
  }

  const categories = doc.categories() as string[];

  state.output = {
    title,
    infobox,
    categories,
  };

  await next();
};

TaskRegistry.register('bulbapedia:parse', task);
