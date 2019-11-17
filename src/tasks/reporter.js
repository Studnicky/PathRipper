const path = require('path');
const { exportContent } = require('../utils');
const { reportDirectory } = require('../config');

const reporter = async function (next, state) {
	//	This is basically the error handler
	try {
		await next();
	} catch (err) {
		console.error(err);
		state.error = {
			message: err.message,
			stack: err.stack.split('\n')
		}
	}
	//	The state field should be filled out up until any failed steps to make it easier to identify
	const filePath = path.resolve(reportDirectory, `${state.category}-report.json`);
	await exportContent(filePath, state);
	//	Return state to transformer
	return state;
};

module.exports = reporter;
