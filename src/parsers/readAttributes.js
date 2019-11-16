
const name = (document) => {
	//  Second header tag with class d-flex contains the name, type and level
	const typeHeader = document.querySelectorAll("header.d-flex");
	const name = typeHeader[1].querySelector("h1").innerHTML.toLowerCase() || null;
	return name;
};

const source = (document) => {
	//  Footer contains the book and page
	const sourceSection = document.querySelector("footer.d-flex");
	//  The source is a link inside of the footer
	const sourceLink = sourceSection.querySelector("a");
	return {
		reference: /(.*)\s\(/.exec(striptags(sourceLink.innerHTML))[1],
		page: /\((\d+)\)/gi.exec(striptags(sourceLink.innerHTML))[1]
	}
};

const actions = (document) => {
	//	@TODO: Some items have their actions in the details, not the content

	//  section tag with class .content contains the actions and details
	const detailsSection = document.querySelector("section.content");
	//  activate is alawys in actions, everything else is details...
	const actions = detailsSection.querySelectorAll("p");
	//  @TODO: This could use more love to parse out the action
	//  @FIXME: number of actions, action type, effect fields
	const actionText = Object.values(actions).reduce((actionString, actionSection) => {
		if (actionSection.innerHTML.toLowerCase().includes("activate")) {
			actionString = actionString.concat(' ', striptags(actionSection.innerHTML));
		}
		return actionString;
	}, new String());
	return toCap(reEncode(actionText).trim());
};


const bulk = (document) => {
	//  section tag with class .details contains the bulk, price, and usage
	const detailsSection = document.querySelector("section.details");
	//  bulk is in one of the <p> tags, immediately after the keyword
	const bulkDetails = detailsSection.querySelectorAll("p");
	const filter = (p) => {
		return bulkDetails[p].innerHTML.toLowerCase().includes("bulk");
	}
	const p = Object.keys(bulkDetails).find(filter);
	let bulk = 0;
	if (p) {
		//  Bulk can be a number or a symbol?
		let bulkText = /bulk\s(s|m|l|\d*\.?\d*)/gi.exec(striptags(bulkDetails[p].innerHTML));
		bulk = Array.isArray(bulkText) ? bulkText[1] : bulk;
	}
	return bulk;
};


const details = (document) => {
	//  section tag with class .content contains the actions and details
	const detailsSection = document.querySelector("section.content");
	//  activate is alawys in actions, everything else is details...
	const details = detailsSection.querySelectorAll("p");
	const detailsText = Object.values(details).reduce((detailString, detailSection) => {
		if (detailSection.innerHTML.toLowerCase().includes("activate") === false) {
			detailString = detailString.concat(' ', striptags(detailSection.innerHTML));
		}
		return detailString;
	}, new String());
	return toCap(reEncode(detailsText).trim());
};

const usage = (document) => {
	//  section tag with class .details contains the bulk, price, and usage
	const detailsSection = document.querySelector("section.details");
	//  usage is in one of the <p> tags, immediately after the keyword
	const usageDetails = detailsSection.querySelectorAll("p");
	const filter = (p) => {
		return usageDetails[p].innerHTML.toLowerCase().includes("usage");
	}
	const p = Object.keys(usageDetails).find(filter);
	let usage = null;
	if (p) {
		let usageText = /usage\s(.*);/gi.exec(striptags(usageDetails[p].innerHTML));
		usage = Array.isArray(usageText) ? usageText[1] : usage;
	}
	return usage ? toCap(reEncode(usage).trim()) : usage;
};


const level = (document) => {
	//  Second header tag with class d-flex contains the name, type and level
	const typeHeader = document.querySelectorAll("header.d-flex")[1];
	const typeString = typeHeader.querySelector("h2").innerHTML;
	const level = /[0-9]+/.exec(typeString);
	return Array.isArray(level) ? level[0] : 0;
};

const price = (document) => {
	//  section tag with class .details contains the bulk, price, and usage
	const detailsSection = document.querySelector("section.details");
	//  price one of the <p> tag inside...
	const priceDetails = detailsSection.querySelectorAll("p");
	const filter = (p) => {
		return priceDetails[p].innerHTML.toLowerCase().includes("price");
	}
	const p = Object.keys(priceDetails).find(filter);
	let price = {
		amount: 0,
		currency: null
	};
	if (p) {
		price.amount = /(\d+)/gi.exec(striptags(priceDetails[p].innerHTML))[1];
		price.currency = /([c|g|s]p)/gi.exec(striptags(priceDetails[p].innerHTML))[1];
	}
	return price;
}

const traits = (document) => {
	//  section tag with class .traits contains the traits
	const traitsSection = document.querySelector("section.traits");
	let traitsList = [];
	//  each trait is an h3 tag inside this but not all items have traits
	if (traitsSection) {
		const traitsHeaders = traitsSection.querySelectorAll("h3");
		Object.values(traitsHeaders).reduce((traitsList, trait) => {
			traitsList.push(trait.innerHTML.toLowerCase());
			return traitsList;
		}, traitsList);
	}
	return traitsList;
};

module.exports = {
	name,
	source,
	actions,
	bulk,
	details,
	usage,
	level,
	price,
	traits,
}
