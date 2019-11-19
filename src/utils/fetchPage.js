const { JSDOM } = require('jsdom');
const { delayTimer } = require('../config');

const fetchPage = async function (url) {
	const jsdomOpts = {};
	await new Promise((resolve) => setTimeout(resolve, delayTimer));
	const page = await JSDOM.fromURL(url, jsdomOpts);
	//  Terminate the jsdom to remove any listeners and stop any script execution
	if (page.hasOwnProperty('window')) { page.window.close(); };
	return page;
}

module.exports = fetchPage;
