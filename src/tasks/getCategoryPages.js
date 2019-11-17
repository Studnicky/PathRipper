const categoryParser = require('../parsers/categoryParser');
const categoryLinks = require('../const/categoryLinks');
const LinkLister = require('../linkLister');

const getCategoryPages = async function (next, state) {

	console.log(`Recursively Indexing Content: ${state.category}`);
	const url = categoryLinks[state.category];
	const linkList = await new LinkLister(state.category).build(url);
	console.log(`Indexed ${linkList.length} pages from ${state.category}`);

	state.data = {};
	for (const link of linkList) {
		state.data[link.split(/\//).pop()] = await categoryParser(link, state.category);
	}

	await next();
}

module.exports = getCategoryPages;
