import React, { useEffect, useState } from "react";
import baseFetch from "isomorphic-unfetch";
import { HttpsAgent } from "agentkeepalive";
import Link from "next/link";

// Supports custom agents!
// This is not required but is for demonstration purposes.
const httpsAgent = new HttpsAgent({});

/**
 * Return a `fetch` function and a HAR log that will collect any entries
 * created by calling it. In the browser, we skip loading `node-fetch-har`
 * completely, because it's meant to apply to `node-fetch` specifically - so
 * the base `fetch` will not be wrapped, and the HAR log will be null.
 */
function createFetch(pageInfo) {
  if (process.browser) {
    return [baseFetch, null];
  } else {
    // Import `node-fetch-har` here.
    const { withHar, createHarLog } = require("../..");
    const har = createHarLog([], pageInfo);
    const fetch = withHar(baseFetch, { har });
    return [fetch, har];
  }
}

DemoPage.getInitialProps = async ctx => {
  // In practice, you probably want to do this in your `_app.js` so it applies
  // to all pages.
  const [fetch, harData] = createFetch({ title: "Demo Page" });

  await fetch("https://httpstat.us/200", { agent: httpsAgent });

  await fetch("https://graphbrainz.herokuapp.com/", {
    agent: httpsAgent,
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
  });

  return { harData };
};

function useHarUrl(har) {
  const [downloadUrl, setDownloadUrl] = useState(null);

  useEffect(() => {
    if (typeof URL !== "undefined" && URL.createObjectURL) {
      const blob = new Blob([JSON.stringify(har)], {
        type: "data:application/json;charset=utf-8"
      });
      const objectUrl = URL.createObjectURL(blob);
      setDownloadUrl(objectUrl);
    }
  }, [har]);

  return downloadUrl;
}

export default function DemoPage({ harData }) {
  const harUrl = useHarUrl(harData);
  return (
    <main>
      {harUrl ? (
        <div>
          <p>
            Click this to download the HAR file, then drag the file into the
            Network tab or another{" "}
            <a
              href="https://toolbox.googleapps.com/apps/har_analyzer/"
              target="_blank"
            >
              HAR viewer
            </a>
            !
          </p>
          <a
            href={harUrl}
            download="next-ssr-demo.har"
            style={{
              padding: "10px 20px",
              fontFamily: "Lato, sans-serif",
              fontWeight: "bold",
              fontSize: 13,
              textDecoration: "none",
              background: "rgb(41, 126, 240)",
              color: "white"
            }}
          >
            Download SSR HAR Log
          </a>
        </div>
      ) : null}
      <p>
        <Link href="/">
          <a>Send requests in browser</a>
        </Link>{" "}
        for comparison
      </p>
      <pre>{JSON.stringify(harData, null, 2)}</pre>
    </main>
  );
}
