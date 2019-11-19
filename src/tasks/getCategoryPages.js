const categoryParser = require('../parsers/categoryParser');
const LinkLister = require('../linkLister');
const { debug, domain, target } = require('../config');

const getCategoryPages = async function (next, state) {

	const linkListerConfig = {
		debug,
		domain: new RegExp(domain),
		target: new RegExp(target),
		delimiter: new RegExp(`${state.category}.aspx`)
	};

	const link = `${domain}/${state.category}.aspx`;
	const linkList = await new LinkLister(linkListerConfig).buildList(link);

	state.data = {};
	for (const link of linkList) {
		state.data[link.split(/\//).pop()] = await categoryParser(link, state.category);
	}

	await next();
}

module.exports = getCategoryPages;
