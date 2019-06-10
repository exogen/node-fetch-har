# node-fetch-har

![npm](https://img.shields.io/npm/v/node-fetch-har.svg)
![Travis](https://img.shields.io/travis/exogen/node-fetch-har.svg)
![Coveralls](https://img.shields.io/coveralls/github/exogen/node-fetch-har.svg)

A [Fetch API][fetch] wrapper that records [HAR logs][har] for server requests
made with [node-fetch][]. You can then expose this data to get visibility into
what’s happening on the server.

![Demo](./demo.gif)

## Status

🧪 **EXPERIMENTAL**

Please test thoroughly to make sure it works for your use case.

## Warning

⚠️ **HAR files can contain sensitive information like cookies or passwords.** Since
this library is for capturing what happens on the server, this is especially
important because it is information that users can’t normally access in their
own browser. Be careful about sharing this data. If you provide a way to expose
it, ensure it is only enabled for superusers or in secure environments.

## Usage

The `withHar` function takes a base Fetch implementation such as `node-fetch`
and returns a new one that records HAR entries:

```js
import { withHar } from "node-fetch-har";
import nodeFetch from "node-fetch";

const fetch = withHar(nodeFetch);
```

Individual HAR entries can then accessed on the `response` object:

```js
fetch("https://httpstat.us/200").then(response => {
  console.log(response.harEntry);
  return response;
});
```

Or by configuring `withHar` with an `onHarEntry` callback:

```js
const fetch = withHar(nodeFetch, {
  onHarEntry: entry => console.log(entry)
});
```

You can also customize `onHarEntry` for individual requests:

```js
const fetch = withHar(nodeFetch);

fetch("https://httpstat.us/200", {
  onHarEntry: entry => console.log(entry)
});
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
calls made while rendering a single page. Use the `createHarLog` function to
generate a complete HAR object that can hold multiple entries.

You can pass the resulting object via the `har` option and entries will
automatically be added to it:

```js
import { withHar, createHarLog } from "node-fetch-har";
import nodeFetch from "node-fetch";

async function run() {
  const har = createHarLog();
  const fetch = withHar(nodeFetch, { har });

  await Promise.all([
    fetch("https://httpstat.us/200"),
    fetch("https://httpstat.us/200"),
    fetch("https://httpstat.us/200")
  ]);

  console.log(har);
}
```

You can also call `createHarLog` with an array of entries, if you’ve already
collected them in a different way:

```js
const har = createHarLog(entries);
```

### …with Isomorphic Fetch

When using “universal” libraries like [isomorphic-fetch][] or [isomorphic-unfetch][],
make sure you only import this library and wrap the Fetch instance on the
server. Not only does this library require built-in Node modules, but it’s
unnecessary in the browser anyway, since you can already spy on requests (and
export HAR logs) via the Network tab.

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

### Redirects

With the Fetch API’s `redirect` option in `follow` mode (the default), calls
will transparently follow redirects; that is, you get the response from the
final, redirected request. Likewise, the `harEntry` property of the response
will correspond with that final request.

To get the HAR entries for the redirects, use the `har` or `onHarEntry` options
(described above). The redirects will be appended to the log and reported with
`onHarEntry` along with the final entry. Note that this means that it’s possible
for a single `fetch` call to result in multiple entries.

### Page Info

The second argument to `createHarLog` allows you to add some initial page info:

```js
const har = createHarLog([], { title: "My Page" });
```

If you have additional pages within a single log, you’ll have to add them
yourself:

```js
har.log.pages.push({ title: "2nd Page" });
```

If not provided, a default page will be created with an ID of `page_1`. By
default, all HAR entries will reference this page. To customize the page that
entries reference, use the `harPageRef` option to `withHar`:

```js
const fetch = withHar(nodeFetch, { har, harPageRef: "page_2" });
```

Or use the `harPageRef` option to `fetch` for individual requests:

```js
await fetch(url, { harPageRef: "page_2" });
```

## Examples

See the [demo](./demo/pages/index.js) for an example of exposing an SSR HAR
log from Next.js.

Run the demo like so:

```console
$ cd demo
$ yarn
$ yarn start
```

## TODO

- Support for request body info.
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
[isomorphic-fetch]: https://github.com/matthew-andrews/isomorphic-fetch
[isomorphic-unfetch]: https://github.com/developit/unfetch
