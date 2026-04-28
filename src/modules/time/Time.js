export class Time {
    constructor() { }
    static sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
