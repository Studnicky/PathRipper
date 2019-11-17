const Transformer = require('../transformer');

const categoryTasks = {
	"Actions": [],
	"Activities": [],
	"Ancestries": [],
	"AnimalCompanions": [],
	"AnimalSpecializations": [],
	"Archetypes": [],
	"ArcaneSchools": [],
	"ArcaneThesis": [],
	"Armor": [],
	"Backgrounds": [],
	"Bloodlines": [],
	"Causes": [],
	"Classes": [],
	"ClassKits": [],
	"ClassSamples": [],
	"Conditions": [],
	"Deities": [],
	"Doctrines": [],
	"Domains": [],
	"DruidicOrders": [],
	"Equipment": [],
	"Familiars": [],
	"Feats": [],
	"Hazards": [],
	"HuntersEdge": [],
	"Instincts": [],
	"Languages": [],
	"Monsters": [],
	"MonsterAbilities": [],
	"MonsterFamilies": [],
	"Muses": [],
	"Rackets": [],
	"ResearchFields": [],
	"Rules": [],
	"Setting": [],
	"Shields": [],
	"Skills": [],
	"Spells": [],
	"Rituals": [],
	"Tenets": [],
	"Traits": [],
	"Weapons": [],
	"WeaponGroups": [],
}

//  Take an array of pages to rip
const categoryParser = async (link, category) => {

	const content = {
		url: link,
		category: category
	};

	const categoryTransformer = new Transformer({ debug: false });
	categoryTransformer.addTasks(categoryTasks[category]);
	const result = await categoryTransformer.execute(content);
	return result[1];
}

module.exports = categoryParser;
