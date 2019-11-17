//	This is a neat thing. I wish it had been around when I actually had to do stuff like this for work.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const fetchPage = require('../utils/fetchPage');

const exclude = (excluder, outstanding) => {
	return outstanding.filter((element) => {
		return excluder.includes(element) === false;
	});
};

const unique = (list) => {
	const result = [];
	const map = new Map();
	for (const link of list) {
		if (map.has(link) === false) {
			map.set(link, true);
			result.push(link);
		}
	}
	return result;
}

const matches = (pattern, links) => {
	return links.filter((link) => {
		return pattern.test(link);
	});
}

const uniqueMatches = (pattern, links) => {
	return unique(matches(pattern, links));
}

const getLinksInElement = (element) => {
	return Array.from(element.querySelectorAll('a'))
		.map((link) => {
			return link.href;
		});
}

class LinkLister {
	constructor(category) {
		this.category = category;
		this.history = [];
	}

	//	This might seem silly but it's a necessary wrapper for the dispatcher
	async IDList(linkList) {
		return linkList;
	};

	async Index(nextLinks) {
		let linkList = [];
		for (const link of nextLinks) {
			const newLinks = await this.build(link);
			linkList = linkList.concat(newLinks);
		}
		return linkList;
	};

	//	This is probably the jankiest dispatcher I have ever written but HEY IT WORKS
	async accumulateLists(link, sortedLists) {
		let links = [];
		for (const linkList of sortedLists) {
			const results = await this[linkList.name](linkList.list, this.category);
			links = links.concat(results);
		}
		return links;
	}

	async build(link) {
		const page = await fetchPage(link);
		const { window: { document: { body } = {} } = {} } = page;
		//	Since there's no way to tell what the page is from the page itself...
		const linkList = uniqueMatches(new RegExp(`${this.category}.aspx`), getLinksInElement(body));
		const sortedLinkLists = [
			{ name: "IDList", list: exclude(this.history, matches(/\?ID=/, linkList)) },
			{ name: "Index", list: exclude(this.history, matches(/(?:category)/gmi, linkList)) }
		];
		//	Track visited pages to prevent recursion nightmares
		this.history.push(link);
		const builtList = await this.accumulateLists(link, sortedLinkLists);
		return builtList.sort(collator.compare);
	}

}


module.exports = LinkLister;
