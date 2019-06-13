const baseFetch = require("node-fetch");
const defineTests = require("./tests");

describe("using node-fetch", () => {
  defineTests(baseFetch);
});
