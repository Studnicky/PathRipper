
const getSubcategoryLinkList = (category, bodyLinks) => {
	return bodyLinks.reduce((linkList, link) => {
		if (link.href.includes(subCategoryLinkText[category])) {
			linkList.push(link.href);
		}
		console.log(link.href);
		return linkList;
	}, []);
};

const subCategoryLinkList = getSubcategoryLinkList(category, bodyLinks);
for (const subCategoryIndex of subCategoryLinkList) {
	const page = await fetchPage(subCategoryIndex);
	const { window: { document } } = page;
	const subCategoryLinks = parseData(document);
	linkList = linkList.concat(getTargetLinks(subCategoryLinks));
}
