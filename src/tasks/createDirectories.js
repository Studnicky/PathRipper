const path = require('path');
const allCategories = require('../const/categories');
const createDirectory = require('../utils/createDirectory');

const createDirectories = async function (next, state) {
	if (allCategories.includes(state.category)) {
		await createDirectory(path.resolve('data', state.category));
	} else {
		throw new Error(`Unknown category: ${state.category}`);
	}
	return next();
}

module.exports = createDirectories;
