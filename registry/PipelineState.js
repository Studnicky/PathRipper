export class PipelineState {
    constructor() { }
    static fromWikiPage(targetId, page) {
        return {
            targetId,
            page: { targetId, title: page.title, url: '', wikitext: page.wikitext },
            output: null,
        };
    }
    static fromHtmlPage(targetId, page) {
        return {
            targetId,
            page: { targetId, title: page.url, url: page.url, html: page.html },
            output: null,
        };
    }
}
