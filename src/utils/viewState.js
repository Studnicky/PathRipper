module.exports = (viewState) => {
	const aspBullshit = new Buffer(viewState, 'base64');
	const decodedString = aspBullshit.toString('ascii');
	//	Thought this might be more useful than it was but it's just encoded HTML
	return decodedString;
}
