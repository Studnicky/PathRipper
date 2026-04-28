// Modernized from PathRipper/src/transformer/index.js
// Transforms the callback-based task queue into typed async middleware.
import { Logger } from '../modules/logger/Logger.js';
export class Pipeline {
    #name;
    #queue = [];
    #log;
    constructor(config = {}) {
        this.#name = config.name ?? 'Pipeline';
        this.#log = Logger.forComponent(this.#name);
    }
    addTask(task) {
        this.#queue.push(task);
        return this;
    }
    addTasks(tasks) {
        for (const task of tasks)
            this.addTask(task);
        return this;
    }
    async execute(state) {
        this.#log.debug('execute', `Running ${this.#queue.length.toString()} tasks`);
        const run = async (index) => {
            const task = this.#queue[index];
            if (task === undefined)
                return;
            await task(() => run(index + 1), state);
        };
        await run(0);
        return state;
    }
}
