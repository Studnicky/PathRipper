const categoryLinks = require('../const/categoryLinks');
const fetchPage = require('../utils/fetchPage');
const categoryParser = require('../parsers/categoryParser');

const getLinks = (body, category) => {
	const contentArea = body.querySelector('#main');
	const linkTags = Array.from(contentArea.querySelectorAll("a"));

	return linkTags.reduce((linkList, link) => {
		const { href } = link;

		console.log(href);

		const hasID = href.includes('?ID=');
		const matchesCategoryText = href.includes(category);

		if (hasID && matchesCategoryText) {
			linkList.push(href);
		}
		return linkList;
	}, []);
}

const getCategoryIndex = async function (next, state) {
	let url = categoryLinks[state.category]();
	const page = await fetchPage(url);
	const { window: { document: { body } = {} } = {} } = page;
	//	We either have an index page or a single page descriptor
	let targetUrlList = getLinks(body);
	targetUrlList = targetUrlList.length > 0 ? targetUrlList : [url];

	console.log(targetUrlList);

	state.data = {};
	for (const url of targetUrlList) {
		state.data[url] = await categoryParser(url, state.category);
	}

	await next();
	//  Terminate the jsdom to remove any listeners and stop any script execution
	if (page.hasOwnProperty('window')) { page.window.close(); };
}
module.exports = getCategoryIndex;
