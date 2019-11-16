const fs = require('fs').promises;

const exporter = async function (filePath, contents) {
	try {
		await fs.writeFile(filePath, JSON.stringify(contents, null, 4));
	} catch (err) {
		//	Don't terminate if the page fails to write
		console.error(`Failed to write`, err);
		console.info(contents);
		throw err;
	}
}

module.exports = exporter;
