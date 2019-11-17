const path = require('path');
const config = require('./config');
require('./utils/createDirectory')(path.resolve(config.reportDirectory));

const Transformer = require('./transformer');
const {
	reporter,
	createDirectories,
	getCategoryPages
} = require('./tasks');

//  Take an array of pages to rip
async function rip(config) {
	for (const category of config.categories) {
		const transformer = new Transformer({ debug: false });
		transformer.addTasks([
			reporter,
			createDirectories,
			getCategoryPages
		]);
		const result = await transformer.execute({ category });
		console.log(result);
	}
}

rip(config);
