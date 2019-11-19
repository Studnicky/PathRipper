const fs = require('fs').promises;

async function createDirectory(directoryPath) {
	try {
		await fs.mkdir(directoryPath, { recursive: true })
	} catch (err) {
		if (err.code !== 'EEXIST') {
			throw err
		}
	}
};

module.exports = createDirectory;
