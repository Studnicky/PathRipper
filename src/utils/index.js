String.prototype.capitalize = function () {
	return this.charAt(0).toUpperCase() + string.slice(1);
};

module.exports = {
	exportContent: require('./exportContent'),
	createDirectory: require('./createDirectory'),
	fetchPage: require('./fetchPage'),
	viewState: require('./viewState'),
};
