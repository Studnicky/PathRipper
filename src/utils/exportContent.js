const fs = require('fs').promises;
const { debug } = require('../config');

const exporter = async function (filePath, contents) {
	try {
		await fs.writeFile(filePath, JSON.stringify(contents, null, 4));
	} catch (err) {
		//	Don't terminate if the page fails to write
		console.error(`Failed to write`, err);
		if (debug) console.info(contents);
		throw err;
	}
}

module.exports = exporter;
