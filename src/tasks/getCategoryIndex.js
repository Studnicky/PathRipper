const allCategories = require('../const/categories');

const getCategoryIndexURL = (category) => {
	//	I have no idea why he did this, but he did.
	//	All the categories looked to be  top level except this one.
	const wtf = `/AnimalCompanions.aspx?Specialized=true`;
	return category === 'AnimalSpecializations' ? wtf : `/${category}.aspx`;	//	y tho
};

const getCategoryIndex = async function (next, state) {
	if (allCategories.includes(state.category)) {
		let url = getCategoryIndexURL(state.category);
		return next(url);
	} else {
		throw new Error(`Unknown category: ${state.category}`);
	}
}
module.exports = getCategoryIndex;
