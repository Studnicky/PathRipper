const path = require('path');
const config = require('./config');
const Transformer = require('./transformer');
const createDirectory = require('./utils/createDirectory');
const {
	reporter,
	createDirectories,
	getCategoryIndex,
	fetchPageContents,
	parseCategoryIndex
} = require('./tasks');

//  Take an array of pages to rip
async function rip(config) {
	for (const category of config.categories) {
		const transformer = new Transformer({ debug: false });
		transformer.addTasks([
			reporter,
			createDirectories,
			getCategoryIndex,
			fetchPageContents,
			parseCategoryIndex
		]);
		const result = await transformer.execute({ category });
		console.log(result);
	}
}

createDirectory(path.resolve('.reports'));
rip(config);
