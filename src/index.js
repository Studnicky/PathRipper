const path = require('path');
const { debug, reportDirectory, categories } = require('./config');
require('./utils/createDirectory')(path.resolve(reportDirectory));

const Transformer = require('./transformer');
const {
	reporter,
	createDirectories,
	getCategoryPages
} = require('./tasks');

//  Take an array of pages to rip
async function rip() {
	for (const category of categories) {
		const transformer = new Transformer({ debug });
		transformer.addTasks([
			reporter,
			createDirectories,
			getCategoryPages
		]);
		const result = await transformer.execute({ category });
		if (debug) console.log(result);
	}
}

rip()
	.then((result) => {
		console.log(result);
		process.exit();
	});
