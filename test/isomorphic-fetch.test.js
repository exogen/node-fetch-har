const baseFetch = require("isomorphic-fetch");
const defineTests = require("./tests");

describe("using isomorphic-fetch", () => {
  defineTests(baseFetch);
});
