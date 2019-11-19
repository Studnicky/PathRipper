const path = require('path');
const { fetchPage, exportContent } = require('../utils');
const { dataDirectory } = require('../config');

const reporter = async function (next, content) {
	const page = await fetchPage(content.url);
	const { window: { document: { body } = {} } = {} } = page;
	const pageContents = body.querySelector('#ctl00_MainContent_DetailedOutput');
	const fileName = `${content.url.split(/\/+/).pop().replace('.aspx?', '').replace("=", '-')}-raw.html`
	//	The state field should be filled out up until any failed steps to make it easier to identify
	const filePath = path.resolve(dataDirectory, content.category, fileName);
	await exportContent(filePath, pageContents.innerHTML);
	//	Return state to transformer
	return next();
};

module.exports = reporter;
