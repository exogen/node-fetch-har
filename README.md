# node-fetch-har

A [Fetch API][fetch] wrapper designed to capture [HAR logs][har] for server
requests made with [node-fetch][]. You can then expose this data to get
visibility into what’s happening on the server.

## Usage

Setup:

```js
import { withHar } from "node-fetch-har";
import nodeFetch from "node-fetch";

const fetch = withHar(nodeFetch);
```

Individual HAR entries can then be obtained by accessing them on the `response`:

```js
fetch("https://httpstat.us/200").then(response => {
  console.log(response.harEntry);
  return response;
});
```

Or by configuring `withHar` with an `onHarEntry` callback:

```js
function onHarEntry(entry) {
  console.log(entry);
}

const fetch = withHar(nodeFetch, { onHarEntry });
```

Or by configuring individual requests with an `onHarEntry` option:

```js
const fetch = withHar(nodeFetch);

function onHarEntry(entry) {
  console.log(entry);
}

fetch("https://httpstat.us/200", { onHarEntry });
```

To disable HAR tracking for individual requests, set the `har` option to `false`:

```js
fetch("https://httpstat.us/200", { har: false }).then(response => {
  console.log(response.harEntry); // Should be undefined.
  return response;
});
```

The above options will give you individual HAR entries. It’s likely that you’ll
want to collect multiple requests into a single HAR log. For example, all API
calls made while rendering a single page. Use the `createHarLog` export to
generate a single valid HAR object:

```js
import { withHar, createHarLog } from "node-fetch-har";
import nodeFetch from "node-fetch";

async function run() {
  const fetch = withHar(nodeFetch);
  const entries = [];
  const onHarEntry = entry => entries.push(entry);

  await Promise.all([
    fetch("https://httpstat.us/200"),
    fetch("https://httpstat.us/200"),
    fetch("https://httpstat.us/200")
  ]);

  const har = createHarLog(entries);
  console.log(har);
}
```

[fetch]: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
[node-fetch]: https://github.com/bitinn/node-fetch
[har]: http://www.softwareishard.com/blog/har-12-spec/
