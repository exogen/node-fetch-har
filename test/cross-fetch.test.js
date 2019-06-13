const baseFetch = require("cross-fetch");
const defineTests = require("./tests");

describe("using cross-fetch", () => {
  defineTests(baseFetch);
});
