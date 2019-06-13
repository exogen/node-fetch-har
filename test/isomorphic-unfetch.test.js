const baseFetch = require("isomorphic-unfetch");
const defineTests = require("./tests");

describe("using isomorphic-unfetch", () => {
  defineTests(baseFetch);
});
