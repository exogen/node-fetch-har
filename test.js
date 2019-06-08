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
    types {
      ...FullType
    }
    directives {
      name
      description
      locations
      args {
        ...InputValue
      }
    }
  }
}

fragment FullType on __Type {
  kind
  name
  description
  fields(includeDeprecated: true) {
    name
    description
    args {
      ...InputValue
    }
    type {
      ...TypeRef
    }
    isDeprecated
    deprecationReason
  }
  inputFields {
    ...InputValue
  }
  interfaces {
    ...TypeRef
  }
  enumValues(includeDeprecated: true) {
    name
    description
    isDeprecated
    deprecationReason
  }
  possibleTypes {
    ...TypeRef
  }
}

fragment InputValue on __InputValue {
  name
  description
  type { ...TypeRef }
  defaultValue
}

fragment TypeRef on __Type {
  kind
  name
  ofType {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
    }
  }
}
`
    })
  }).then(
    response => {
      console.log(createHarLog([response.harEntry]));
    },
    err => {
      console.error(err);
    }
  );
}

run();
