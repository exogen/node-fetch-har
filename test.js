const nodeFetch = require("node-fetch");
const { withHar, createHarLog } = require("./index");

async function run() {
  const fetch = withHar(nodeFetch);

  await fetch("https://httpstat.us/200").then(response => {
    console.log(response.harEntry);
  });

  await fetch("https://httpstat.us/200", {
    onHarEntry: entry => {
      console.log("from onHarEntry:", entry);
    }
  });

  await fetch("https://httpstat.us/200", { har: false }).then(response => {
    console.log("Should be undefined:", response.harEntry);
    return response;
  });

  await fetch("https://graphbrainz.herokuapp.com/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: `
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    directives {
      name
      description
      locations
    }
  }
}`
    })
  }).then(response => {
    console.log(createHarLog([response.harEntry]));
  });
}

run();
