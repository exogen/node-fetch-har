module.exports = {
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: "script"
  },
  env: {
    es6: true,
    jest: true,
    node: true
  },
  extends: ["eslint:recommended"],
  rules: {
    "no-console": "off"
  }
};
