const { delayTimer } = require('../config');

const delayNext = async function (next) {
	await new Promise((resolve) => setTimeout(resolve, delayTimer));
	return next();
}

module.exports = delayNext;
