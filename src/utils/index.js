String.prototype.capitalize = function () {
	return this.charAt(0).toUpperCase() + string.slice(1);
};

module.exports = {
	exportContent: require('./exportContent'),
	createDirectory: require('./createDirectory'),
	fetchPageContents: require('./fetchPageContents'),
	viewState: require('./viewState'),
};
