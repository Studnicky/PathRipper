import wtf from 'wtf_wikipedia';
import { TaskRegistry } from '../../dist/registry/TaskRegistry.js';
const MASTERS_INFOBOX_TEMPLATE = 'mastersinfobox';
const INFOBOX_FIELDS = [
    'name', 'jname', 'jtrans', 'type', 'num', 'image', 'desc',
    'enva', 'java', 'caption',
];
const task = async (next, state) => {
    const { title, wikitext } = state.page;
    if (!wikitext) {
        await next();
        return;
    }
    const doc = wtf(wikitext);
    // wtf_wikipedia parses MastersInfobox as a generic template, not an infobox.
    // Find it by the normalized template name.
    const templates = doc.templates();
    const raw = templates.find((t) => t.json()['template'] === MASTERS_INFOBOX_TEMPLATE);
    const rawData = raw !== undefined ? raw.json() : {};
    const infobox = {};
    for (const f of INFOBOX_FIELDS) {
        const val = rawData[f];
        infobox[f] = val !== undefined && val !== '' ? val : null;
    }
    const categories = doc.categories();
    state.output = {
        title,
        infobox,
        categories,
    };
    await next();
};
TaskRegistry.register('bulbapedia:parse', task);
