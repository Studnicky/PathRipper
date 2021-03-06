const path = require('path');
const { dataDirectory } = require('../config');
const categories = require('../const/categories');
const createDirectory = require('../utils/createDirectory');

const createDirectories = async function (next, state) {
	if (categories.includes(state.category)) {
		await createDirectory(path.resolve(dataDirectory, state.category));
		return next();
	} else {
		throw new Error(`Unknown category: ${state.category}`);
	}
}

module.exports = createDirectories;
