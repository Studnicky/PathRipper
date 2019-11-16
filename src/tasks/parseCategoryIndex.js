// const decodeViewState = require('../utils/viewState');

const parseCategoryIndex = async function (next, state, url, document) {
	const { body } = document;
	//	some ASP bullshit I was really hoping would be more useful
	//	Turns out it's just encoded html from serverside rendering
	// const viewState = body.querySelector("#__VIEWSTATE");
	// const decoded = decodeViewState(viewState.value);
	// state.rawData = decoded;

	let allLinks = Array.from(body.querySelectorAll("a"));

	const categoryLinks = allLinks.reduce((linkList, link) => {
		if (link.href.includes('?ID=')) {
			linkList.push(link.href);
		}
		console.log(link.href);
		return linkList;
	}, []);

	console.log(categoryLinks);
	debugger;

	return next();
}

module.exports = parseCategoryIndex;
