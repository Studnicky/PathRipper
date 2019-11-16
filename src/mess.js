

const categories = require('../parsers/categories');
const attributes = require('../parsers/readAttributes');

const contentsDispatcher = (category, page, itemId) => {
	const { window: { document = {} } = {} } = page;


	//	I have no idea why he did this, but he did.
	//	All the categories are top level except this one.
	const normalURL = `${config.baseURL}/${category}.aspx?ID=${pageId}`;
	const wtfURL = `${config.baseURL}/AnimalCompanions.aspx?ID=${pageId}&Specialized=true`;
	const pageURL = category === 'AnimalSpecializations' ? normalURL : wtfURL;	//	y tho

	return {
		...{
			itemId,
			category,
			name: attributes.name(document),
			source: attributes.source(document)
		},
		...categories[category](document)
	};
}

module.exports = contentsDispatcher;



const subCategories = {
	'Equipment': 'Category'
}

module.exports = (page, category) => {
	const { window: { document: { body: content } = {} } = {} } = page;
	//	Categories will either include a series of details links
	//	Or they're going to be a single page that lists the data
	const linkTags = content.querySelectorAll("a");
	const pages = Object.values(linkTags).find((link) => {
		return link.href.toLowerCase().includes(category.toLowerCase());
	});
	if (Array.isArray(pages)) {
		return pages.map((pageLink) => {
			return /(\d+)/gi.exec(pageLink)[1];
		});
	} else {
		//	If there aren't category links, it's a single page category
		return [content];
	}
};
