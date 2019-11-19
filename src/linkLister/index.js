//	This is a neat thing. I wish it had been around when I actually had to do stuff like this for work.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const fetchPage = require('../utils/fetchPage');

const exclude = (excluder, outstanding) => {
	return outstanding.filter((element) => {
		return excluder.includes(element) === false;
	});
};

const unique = (list) => {
	return Array.from(new Set(list));
}

const getLinksInElement = (element) => {
	return Array.from(element.querySelectorAll('a'))
		.map((link) => {
			return link.href;
		});
}

//	Recursively crawl through all pages in config.domain
//	Build a list of links that match config.target
//	Traverse all links that match config.delimiter (regex may include or exclude)
class LinkLister {
	constructor(config = {}) {
		this.debug = config.debug;
		this.domain = new RegExp(config.domain);
		this.target = new RegExp(config.target);
		this.delimiter = new RegExp(config.delimiter);
		this.history = [];
	}

	logTag() {
		return `\x1b[44m${this.constructor.name}:\x1b[0m`;
	}

	async traverseLists(lists) {
		let list = lists["true"];
		for (const link of lists["false"]) {
			const linksList = await this.buildList(link);
			list = list.concat(linksList);
		}
		return list;
	}

	async buildList(link) {
		if (this.debug) console.info(`${this.logTag()} Recursively Indexing from: ${link}`);
		const page = await fetchPage(link);
		const { window: { document: { body } = {} } = {} } = page;
		//	Since there's no way to tell what the page is from the page itself...
		let list = getLinksInElement(body)
			.filter((link) => { return this.domain.test(link); })
			.filter((link) => { return this.delimiter.test(link); });
		list = exclude(this.history, list);
		list = unique(list);

		const lists = list.reduce((lists, link) => {
			if (this.history.includes(link)) {
				if (this.debug) console.info(`${this.logTag()} Skipping previously traversed link: ${link}`);
			} else {
				lists[this.target.test(link)].push(link);
				this.history.push(link);
			}
			return lists;
		}, {
			true: [],
			false: []
		});
		//	Track visited pages to prevent recursion nightmares
		const builtList = await this.traverseLists(lists);
		if (this.debug) console.info(`${this.logTag()} Indexed ${builtList.length} pages from: ${link}`);
		return builtList.sort(collator.compare);
	}
}

module.exports = LinkLister;
