


// const categories = require('./categories');
// const attributes = require('./readAttributes');

// const contentsDispatcher = (category, page, itemId) => {
// 	const { window: { document = {} } = {} } = page;


// 	return {
// 		...{
// 			itemId,
// 			category,
// 			name: attributes.name(document),
// 			source: attributes.source(document)
// 		},
// 		...categories[category](document)
// 	};
// }

// module.exports = contentsDispatcher;




// module.exports = (page, category) => {
// 	const { window: { document: { body: content } = {} } = {} } = page;
// 	//	Categories will either include a series of details links
// 	//	Or they're going to be a single page that lists the data
// 	} else {
// 		//	If there aren't category links, it's a single page category
// 		return [content];
// 	}
// };
