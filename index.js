const { URL } = require("url");
const http = require("http");
const https = require("https");
const querystring = require("querystring");
const generateId = require("nanoid");
const cookie = require("cookie");
const setCookie = require("set-cookie-parser");

const headerName = "x-har-request-id";

function handleRequest(harEntryMap, request, options) {
  if (!options || typeof options !== "object") {
    throw new Error("Unsupported Node.js Agent implementation");
  }

  const headers = options.headers || {};
  const requestId = headers[headerName] ? headers[headerName][0] : null;

  if (!requestId) {
    return;
  }

  // Redirects! Fetch follows them (in `follow`) mode and uses the same request
  // headers. So we'll see multiple requests with the same ID. We should remove
  // any previous entry from `harEntryMap` and attach it has a "parent" to this
  // one.
  const parentEntry = harEntryMap.get(requestId);
  if (parentEntry) {
    harEntryMap.delete(requestId);
  }

  const now = Date.now();
  const url = new URL(options.url || options.href); // Depends on Node version?

  const entry = {
    _parent: parentEntry,
    _timestamps: {
      start: now,
      sent: now
    },
    startedDateTime: new Date(now).toISOString(),
    cache: {
      beforeRequest: null,
      afterRequest: null
    },
    timings: {
      // Chrome's HAR viewer (the Network panel) is broken. If `blocked` is
      // not a positive number, it shows the `wait` time as stalled instead
      // of the time waiting for the response.
      blocked: 0.01,
      dns: -1,
      connect: -1,
      send: 0,
      wait: 0,
      receive: 0,
      ssl: -1
    },
    request: {
      method: request.method,
      url: url.href,
      cookies: buildRequestCookies(headers),
      headers: buildHeaders(headers),
      queryString: [...url.searchParams].map(([name, value]) => ({
        name,
        value
      })),
      headersSize: -1,
      bodySize: -1
    },
    response: {
      headersSize: -1,
      bodySize: 0
    }
  };

  // Some versions of `node-fetch` will put `body` in the `options` received by
  // this function and others exclude it. Instead we have to capture writes to
  // the `ClientRequest` stream. There might be some official way to do this
  // with streams, but the events and piping I tried didn't work. FIXME?
  const _write = request.write;
  const _end = request.end;
  let requestBody;

  const concatBody = chunk => {
    // Assume the writer will be consistent such that we wouldn't get Buffers in
    // some writes and strings in others.
    if (typeof chunk === "string") {
      if (requestBody == null) {
        requestBody = chunk;
      } else {
        requestBody += chunk;
      }
    } else if (Buffer.isBuffer(chunk)) {
      if (requestBody == null) {
        requestBody = chunk;
      } else {
        requestBody = Buffer.concat([requestBody, chunk]);
      }
    }
  };

  request.write = function(...args) {
    concatBody(...args);
    return _write.call(this, ...args);
  };

  request.end = function(...args) {
    concatBody(...args);

    if (requestBody != null) {
      // Works for both buffers and strings.
      entry.request.bodySize = requestBody.length;

      let mimeType;
      for (const name in headers) {
        if (name.toLowerCase() === "content-type") {
          mimeType = headers[name][0];
          break;
        }
      }

      if (mimeType) {
        const bodyString = requestBody.toString(); // FIXME: Assumes encoding?
        if (mimeType === "application/x-www-form-urlencoded") {
          entry.request.postData = {
            mimeType,
            params: buildParams(bodyString)
          };
        } else {
          entry.request.postData = { mimeType, text: bodyString };
        }
      }
    }

    return _end.call(this, ...args);
  };

  request.on("response", response => {
    entry._timestamps.firstByte = Date.now();
    harEntryMap.set(requestId, entry);
    const httpVersion = `HTTP/${response.httpVersion}`;

    // Populate request info that isn't available until now.
    entry.request.httpVersion = httpVersion;

    entry.response = {
      status: response.statusCode,
      statusText: response.statusMessage,
      httpVersion,
      cookies: buildResponseCookies(response.headers),
      headers: buildHeaders(response.rawHeaders),
      content: {
        size: -1,
        mimeType: response.headers["content-type"]
      },
      redirectURL: response.headers.location || "",
      headersSize: -1,
      bodySize: -1
    };
  });
}

/**
 * Support the three possible header formats we'd get from a request or
 * response:
 *
 * - A flat array with both names and values: [name, value, name, value, ...]
 * - An object with array values: { name: [value, value] }
 * - An object with string values: { name: value }
 */
function buildHeaders(headers) {
  const list = [];
  if (Array.isArray(headers)) {
    for (let i = 0; i < headers.length; i += 2) {
      list.push({
        name: headers[i],
        value: headers[i + 1]
      });
    }
  } else {
    Object.keys(headers).forEach(name => {
      const values = Array.isArray(headers[name])
        ? headers[name]
        : [headers[name]];
      values.forEach(value => {
        list.push({ name, value });
      });
    });
  }
  return list;
}

function buildRequestCookies(headers) {
  const cookies = [];
  for (const header in headers) {
    if (header.toLowerCase() === "cookie") {
      headers[header].forEach(headerValue => {
        const parsed = cookie.parse(headerValue);
        for (const name in parsed) {
          const value = parsed[name];
          cookies.push({ name, value });
        }
      });
    }
  }
  return cookies;
}

function buildParams(paramString) {
  const params = [];
  const parsed = querystring.parse(paramString);
  for (const name in parsed) {
    const value = parsed[name];
    if (Array.isArray(value)) {
      value.forEach(item => {
        params.push({ name, value: item });
      });
    } else {
      params.push({ name, value });
    }
  }
  return params;
}

function buildResponseCookies(headers) {
  const cookies = [];
  const setCookies = headers["set-cookie"];
  if (setCookies) {
    setCookies.forEach(headerValue => {
      const parsed = setCookie.parse(headerValue);
      parsed.forEach(cookie => {
        const { name, value, path, domain, expires, httpOnly, secure } = cookie;
        const harCookie = {
          name,
          value,
          httpOnly: httpOnly || false,
          secure: secure || false
        };
        if (path) {
          harCookie.path = path;
        }
        if (domain) {
          harCookie.domain = domain;
        }
        if (expires) {
          harCookie.expires = expires.toISOString();
        }
        cookies.push(harCookie);
      });
    });
  }
  return cookies;
}

function createAgentClass(BaseAgent) {
  class HarAgent extends BaseAgent {
    constructor({ harEntryMap, ...options } = {}, ...args) {
      super(options, ...args);
      this.harEntryMap = harEntryMap;
    }

    // This method is undocumented in the Node.js Agent docs. But every custom
    // agent implementation out there uses it, so...
    addRequest(request, ...args) {
      handleRequest(this.harEntryMap, request, ...args);
      return super.addRequest(request, ...args);
    }
  }

  return HarAgent;
}

const HarHttpAgent = createAgentClass(http.Agent);
const HarHttpsAgent = createAgentClass(https.Agent);

function getInputUrl(input) {
  // Support URL or Request object.
  const url = typeof input === "string" ? input : input.url;
  return new URL(url);
}

function addHeaders(oldHeaders, newHeaders) {
  if (!oldHeaders) {
    return newHeaders;
  } else if (
    typeof oldHeaders.set === "function" &&
    typeof oldHeaders.constructor === "function"
  ) {
    const Headers = oldHeaders.constructor;
    const headers = new Headers(oldHeaders);
    for (const name in newHeaders) {
      headers.set(name, newHeaders[name]);
    }
    return headers;
  } else {
    return Object.assign({}, oldHeaders, newHeaders);
  }
}

function withHar(baseFetch, defaults = {}) {
  // Ideally we could just attach the generated entry data to the request
  // directly, like via a header. An ideal place would be in a header, but the
  // headers are already processed by the time the response is finished, so we
  // can't add it there.
  //
  // We could also give each request its own Agent instance that knows how to
  // populate an entry for each given request, but it seems expensive to
  // create new one for every single request.
  //
  // So instead, we generate an ID for each request and attach it to a request
  // header. The agent then adds the entry data to the Map above using the ID
  // as a key.

  // Undocumented option just for testing.
  const harEntryMap = defaults.harEntryMap || new Map();

  let httpAgent = new HarHttpAgent({ harEntryMap });
  let httpsAgent = new HarHttpsAgent({ harEntryMap });

  const getAgent = url => {
    return url.protocol === "http:" ? httpAgent : httpsAgent;
  };

  return function fetch(input, options = {}) {
    const {
      har = defaults.har,
      harPageRef = defaults.harPageRef,
      onHarEntry = defaults.onHarEntry
    } = options;

    if (har === false) {
      return baseFetch(input, options);
    }

    const requestId = generateId();
    const url = getInputUrl(input);

    options = Object.assign({}, options, {
      headers: addHeaders(options.headers, { [headerName]: requestId }),
      // node-fetch 2.x supports a function here, but 1.x does not. So parse
      // the URL and implement protocol-switching ourselves.
      agent: getAgent(url)
    });

    return baseFetch(input, options).then(
      async response => {
        const entry = harEntryMap.get(requestId);
        harEntryMap.delete(requestId);

        if (!entry) {
          return response;
        }

        // We need to consume the decoded response in order to populate the
        // `response.content` field.
        const text = await response.text();

        const { _timestamps: time } = entry;
        time.received = Date.now();

        const parents = [];
        let parent = entry._parent;
        while (parent) {
          parents.unshift(parent);
          parent = parent._parent;
        }

        // In some versions of `node-fetch`, the returned `response` is actually
        // an instance of `Body`, not `Response`, and the `Body` class does not
        // set a `headers` property when constructed. So instead of using
        // `response.constructor`, try to get `Response` from other places, like
        // on the given Fetch instance or the global scope (like `isomorphic-fetch`
        // sets). If all else fails, you can override the class used via the
        // `Response` option to `withHar`.
        const Response =
          defaults.Response ||
          baseFetch.Response ||
          global.Response ||
          response.constructor;

        // `clone()` is broken in `node-fetch` and results in a stalled Promise
        // for responses above a certain size threshold. So construct a similar
        // clone ourselves...
        const responseCopy = new Response(text, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          // These are not spec-compliant `Response` options, but `node-fetch`
          // has them.
          ok: response.ok,
          size: response.size,
          url: response.url
        });

        // Allow grouping by pages.
        entry.pageref = harPageRef || "page_1";
        parents.forEach(parent => {
          parent.pageref = harPageRef || "page_1";
        });
        // Response content info.
        entry.response.content.text = text;
        entry.response.content.size = text.length;
        entry.response.bodySize = text.length;
        // Finalize timing info.
        entry.timings.send = time.sent - time.start;
        entry.timings.wait = time.firstByte - time.sent;
        entry.timings.receive = time.received - time.firstByte;
        entry.time =
          entry.timings.blocked +
          entry.timings.send +
          entry.timings.wait +
          entry.timings.receive;

        responseCopy.harEntry = entry;

        if (har && typeof har === "object") {
          har.log.entries.push(...parents, entry);
        }

        if (onHarEntry) {
          parents.forEach(parent => {
            onHarEntry(parent);
          });
          onHarEntry(entry);
        }

        return responseCopy;
      },
      err => {
        harEntryMap.delete(requestId);
        throw err;
      }
    );
  };
}

function createHarLog(entries = [], pageInfo = {}) {
  return {
    log: {
      version: "1.2",
      creator: {
        name: "node-fetch-har",
        version: "0.4"
      },
      pages: [
        Object.assign(
          {
            startedDateTime: new Date().toISOString(),
            id: "page_1",
            title: "Page",
            pageTimings: {
              onContentLoad: -1,
              onLoad: -1
            }
          },
          pageInfo
        )
      ],
      entries
    }
  };
}

exports.withHar = withHar;
exports.createHarLog = createHarLog;
