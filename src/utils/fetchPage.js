const { JSDOM } = require('jsdom');

const fetchPage = async function (url) {
	const jsdomOpts = {};
	return await JSDOM.fromURL(url, jsdomOpts);
}

module.exports = fetchPage;
