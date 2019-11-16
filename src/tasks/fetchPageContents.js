const { baseURL } = require('../config');
const { JSDOM } = require('jsdom');

const fetchPageContents = async function (next, state, url) {
	const jsdomOpts = {};
	const page = await JSDOM.fromURL(`${baseURL}/${url}`, jsdomOpts);
	const { window: { document = {} } = {} } = page;
	await next(document);
	//  Terminate the jsdom to remove any listeners and stop any script execution
	if (page.hasOwnProperty('window')) { page.window.close(); };
}

module.exports = fetchPageContents;
