const { URL } = require("url");
const http = require("http");
const https = require("https");
const querystring = require("querystring");
const generateId = require("nanoid");
const cookie = require("cookie");
const setCookie = require("set-cookie-parser");
const {
  name: packageName,
  version: packageVersion
} = require("./package.json");

const headerName = "x-har-request-id";
const harEntryMap = new Map();

function getDuration(a, b) {
  const seconds = b[0] - a[0];
  const nanoseconds = b[1] - a[1];
  return seconds * 1000 + nanoseconds / 1e6;
}

function handleRequest(request, options) {
  if (!options || typeof options !== "object") {
    return;
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
  const startTime = process.hrtime();
  const url = new URL(options.url || options.href); // Depends on Node version?

  const entry = {
    _parent: parentEntry,
    _timestamps: {
      start: startTime
    },
    _resourceType: "fetch",
    startedDateTime: new Date(now).toISOString(),
    cache: {
      beforeRequest: null,
      afterRequest: null
    },
    timings: {
      blocked: -1,
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
      entry.request.bodySize = Buffer.byteLength(requestBody);

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

  let removeSocketListeners;

  request.on("socket", socket => {
    entry._timestamps.socket = process.hrtime();

    const onLookup = () => {
      entry._timestamps.lookup = process.hrtime();
    };

    const onConnect = () => {
      entry._timestamps.connect = process.hrtime();
    };

    const onSecureConnect = () => {
      entry._timestamps.secureConnect = process.hrtime();
    };

    socket.once("lookup", onLookup);
    socket.once("connect", onConnect);
    socket.once("secureConnect", onSecureConnect);

    removeSocketListeners = () => {
      socket.removeListener("lookup", onLookup);
      socket.removeListener("connect", onConnect);
      socket.removeListener("secureConnect", onSecureConnect);
    };
  });

  request.on("finish", () => {
    entry._timestamps.sent = process.hrtime();
    removeSocketListeners();
  });

  request.on("response", response => {
    entry._timestamps.firstByte = process.hrtime();
    harEntryMap.set(requestId, entry);

    // Now we know whether `lookup` or `connect` happened. It's possible they
    // were skipped if the hostname was already resolved (or we were given an
    // IP directly), or if a connection was already open (e.g. due to
    // `keep-alive`).
    if (!entry._timestamps.lookup) {
      entry._timestamps.lookup = entry._timestamps.socket;
    }
    if (!entry._timestamps.connect) {
      entry._timestamps.connect = entry._timestamps.lookup;
    }

    // Populate request info that isn't available until now.
    const httpVersion = `HTTP/${response.httpVersion}`;
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

    // Detect supported compression encodings.
    const compressed = /^(gzip|compress|deflate|br)$/.test(
      response.headers["content-encoding"]
    );

    if (compressed) {
      entry._compressed = true;
      response.on("data", chunk => {
        if (entry.response.bodySize === -1) {
          entry.response.bodySize = 0;
        }
        entry.response.bodySize += Buffer.byteLength(chunk);
      });
    }
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
      let parsed;
      try {
        parsed = setCookie.parse(headerValue);
      } catch (err) {
        return;
      }
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

/**
 * Instrument an existing Agent instance. This overrides the instance's
 * `addRequest` method. It should be fine to continue using for requests made
 * without `withHar` - if the request doesn't have our `x-har-request-id`
 * header, it won't do anything extra.
 */
function instrumentAgentInstance(agent) {
  const { addRequest: originalAddRequest } = agent;
  if (!originalAddRequest.isHarEnabled) {
    agent.addRequest = function addRequest(request, ...args) {
      handleRequest(request, ...args);
      return originalAddRequest.call(this, request, ...args);
    };
    agent.addRequest.isHarEnabled = true;
  }
}

function createAgentClass(BaseAgent) {
  class HarAgent extends BaseAgent {
    constructor(...args) {
      super(...args);
      this.addRequest.isHarEnabled = true;
    }

    // This method is undocumented in the Node.js Agent docs. But every custom
    // agent implementation out there uses it, so...
    addRequest(request, ...args) {
      handleRequest(request, ...args);
      return super.addRequest(request, ...args);
    }
  }

  return HarAgent;
}

const HarHttpAgent = createAgentClass(http.Agent);
const HarHttpsAgent = createAgentClass(https.Agent);

// Shared agent instances.
let globalHttpAgent;
let globalHttpsAgent;

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

function getAgent(input, options) {
  if (options.agent) {
    if (typeof options.agent === "function") {
      return function(...args) {
        const agent = options.agent.call(this, ...args);
        if (agent) {
          instrumentAgentInstance(agent);
          return agent;
        }
        return getGlobalAgent(input);
      };
    }
    instrumentAgentInstance(options.agent);
    return options.agent;
  }
  return getGlobalAgent(input);
}

function getGlobalAgent(input) {
  const url = getInputUrl(input);
  if (url.protocol === "http:") {
    if (!globalHttpAgent) {
      globalHttpAgent = new HarHttpAgent();
    }
    return globalHttpAgent;
  }
  if (!globalHttpsAgent) {
    globalHttpsAgent = new HarHttpsAgent();
  }
  return globalHttpsAgent;
}

function withHar(baseFetch, defaults = {}) {
  return function fetch(input, options = {}) {
    const {
      har = defaults.har,
      harPageRef = defaults.harPageRef,
      onHarEntry = defaults.onHarEntry
    } = options;

    if (har === false) {
      return baseFetch(input, options);
    }

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
    // header. The agent then adds the entry data to `harEntryMap` using the ID
    // as a key.
    const requestId = generateId();

    options = Object.assign({}, options, {
      headers: addHeaders(options.headers, { [headerName]: requestId }),
      // node-fetch 2.x supports a function here, but 1.x does not. So parse
      // the URL and implement protocol-switching ourselves.
      agent: getAgent(input, options)
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
        time.received = process.hrtime();

        const parents = [];
        let child = entry;
        do {
          let parent = child._parent;
          // Remove linked parent references as they're flattened.
          delete child._parent;
          if (parent) {
            parents.unshift(parent);
          }
          child = parent;
        } while (child);

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
          parent.pageref = entry.pageref;
        });
        // Response content info.
        const bodySize = Buffer.byteLength(text);
        entry.response.content.text = text;
        entry.response.content.size = bodySize;
        if (entry._compressed) {
          if (entry.response.bodySize !== -1) {
            entry.response.content.compression =
              entry.response.content.size - entry.response.bodySize;
          }
        } else {
          entry.response.bodySize = bodySize;
        }
        // Finalize timing info.
        // Chrome's HAR viewer (the Network panel) is broken and doesn't honor
        // the HAR spec. If `blocked` is not a positive number, it shows the
        // `wait` time as stalled instead of the time waiting for the response.
        entry.timings.blocked = Math.max(
          getDuration(time.start, time.socket),
          0.01 // Minimum value, see above.
        );
        entry.timings.dns = getDuration(time.socket, time.lookup);
        entry.timings.connect = getDuration(
          time.lookup,
          // For backwards compatibility with HAR 1.1, the `connect` timing
          // includes `ssl` instead of being mutually exclusive.
          time.secureConnect || time.connect
        );
        if (time.secureConnect) {
          entry.timings.ssl = getDuration(time.connect, time.secureConnect);
        }
        entry.timings.send = getDuration(
          time.secureConnect || time.connect,
          time.sent
        );
        entry.timings.wait = Math.max(
          // Seems like it might be possible to receive a response before the
          // request fires its `finish` event. This is just a hunch and it would
          // be worthwhile to disprove.
          getDuration(time.sent, time.firstByte),
          0
        );
        entry.timings.receive = getDuration(time.firstByte, time.received);
        entry.time = getDuration(time.start, time.received);

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

withHar.harEntryMap = harEntryMap;

function createHarLog(entries = [], pageInfo = {}) {
  return {
    log: {
      version: "1.2",
      creator: {
        name: packageName,
        version: packageVersion
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
