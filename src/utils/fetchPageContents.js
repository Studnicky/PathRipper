
const fetchPageContents = async function (next, content, ...args) {
	const url = `${baseURL}/${content.category}.aspx`;
	const jsdomOpts = {};
	const page = await JSDOM.fromURL(url, jsdomOpts);
	const { window: { document = {} } = {} } = page;

	await next();

	//  Terminate the jsdom to remove any listeners and stop any script execution
	if (page.hasOwnProperty('window')) { page.window.close(); };
}



module.exports = fetchPageContents;
