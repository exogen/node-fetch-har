# node-fetch-har

A [Fetch API][fetch] wrapper designed to capture [HAR logs][har] for server
requests made with [node-fetch][]. You can then expose this data to get
visibility into what’s happening on the server.

![Demo](./demo.gif)

## Status

🧪 **EXPERIMENTAL**

Please test thoroughly to make sure it works for your use case.

## Warning

⚠️ **HAR files can contain sensitive information like cookies or passwords.** Since
this library is for capturing what happens on the server, this is especially
important because it is information that users can’t normally access in their
own browser. Be careful about sharing this data. If you provide a method of
exposing it, ensure it is only enabled for superusers or in secure environments.

The `withHar` function takes a base Fetch implementation such as `node-fetch`
and returns a new one that captures HAR entries:

## Usage

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

### …with Isomorphic Fetch

Make sure you only import this library and wrap the Fetch instance supplied by
libraries like `isomorphic-fetch` or `isomorphic-unfetch` on the server. Not
only does this library use built-in Node modules, but you don’t need it in the
browser anyway, because you can already use the Network tab to spy on requests.

The following example assumes your bundler (e.g. webpack) is configured to strip
out conditional branches based on `process.browser`.

```js
import baseFetch from "isomorphic-unfetch";

let fetch = baseFetch;

if (!process.browser) {
  const { withHar } = require("node-fetch-har");
  fetch = withHar(baseFetch);
}
```

## Examples

See the [demo](./demo/pages/index.js) for an example of exposing a SSR HAR
log from Next.js.

Run the demo like so:

```console
$ cd demo
$ yarn
$ yarn start
```

## TODO

- Populate the `cookies` property.
- Support for compression info.
- Better tests with multiple response types, encodings, etc.

## How does it work?

`node-fetch` supports a custom `agent` option. This can be used to capture very
detailed information about the request all the way down to the socket level if
desired. This library only uses it in a very simplistic way, to capture a few
key timestamps and metadata like the HTTP version.

[fetch]: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
[node-fetch]: https://github.com/bitinn/node-fetch
[har]: http://www.softwareishard.com/blog/har-12-spec/
