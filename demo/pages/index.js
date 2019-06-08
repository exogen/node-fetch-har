import baseFetch from "isomorphic-unfetch";

/**
 * Return a `fetch` implementation and a function that will return the full HAR
 * log containing any entries generated up to that point. In the browser, we
 * skip loading `node-fetch-har` completely, because it's meant to apply to
 * `node-fetch` specifically, and we already have the Network tab available in
 * the browser anyway!
 */
function createFetch() {
  if (process.browser) {
    const getHarData = () => null;
    return [baseFetch, getHarData];
  } else {
    const { withHar, createHarLog } = require("../..");
    const entries = [];
    const onHarEntry = entry => entries.push(entry);
    const fetch = withHar(baseFetch, { onHarEntry });
    const getHarData = () => createHarLog(entries);
    return [fetch, getHarData];
  }
}

DemoPage.getInitialProps = async ctx => {
  // In practice, you probably want to do this in your `_app.js` so it applies
  // to all pages.
  const [fetch, getHarData] = createFetch();

  await fetch("https://httpstat.us/200");

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
  });

  return {
    harData: getHarData()
  };
};

// Do this in your `_app.js` to apply it to every page!
export default function DemoPage({ harData }) {
  let harUrl;
  if (harData) {
    const harString = JSON.stringify(harData);
    harUrl = `data:application/json;charset=utf-8,${encodeURIComponent(
      harString
    )}`;
  }
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
      <pre>{JSON.stringify(harData, null, 2)}</pre>
    </main>
  );
}
