const { URL } = require("url");
const http = require("http");
const https = require("https");
const generateId = require("nanoid");

const headerName = "x-har-request-id";

function handleRequest(harEntryMap, request, options) {
  if (!options || typeof options !== "object") {
    throw new Error("Unsupported Node.js Agent implementation");
  }

  const requestId =
    options.headers && options.headers[headerName]
      ? options.headers[headerName][0]
      : null;

  if (!requestId) {
    return;
  }

  const url = new URL(options.url || options.href); // Depends on Node version?

  const now = Date.now();
  const entry = {
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
      headersSize: -1,
      bodySize: -1
    },
    response: {
      headersSize: -1,
      bodySize: 0
    }
  };

  entry.request.url = url.href;
  entry.request.queryString = [...url.searchParams].map(([name, value]) => ({
    name,
    value
  }));
  entry.request.cookies = [];
  entry.request.headers = buildHeaders(options.headers);

  request.on("response", response => {
    harEntryMap.set(requestId, entry);
    entry._timestamps.firstByte = Date.now();
    entry.request.httpVersion = `HTTP/${response.httpVersion}`;
    entry.response.status = response.statusCode;
    entry.response.statusText = response.statusMessage;
    entry.response.httpVersion = entry.request.httpVersion;
    entry.response.headers = buildHeaders(response.rawHeaders);
    entry.response.cookies = [];
    entry.response.content = {
      size: -1,
      mimeType: response.headers["content-type"]
    };
    entry.response.redirectURL = response.headers.location || "";
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
    Object.keys(newHeaders).forEach(name => {
      headers.set(name, newHeaders[name]);
    });
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
  const harEntryMap = new Map();

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

        // `clone()` is broken in `node-fetch` and results in a stalled Promise
        // for responses above a certain size threshold. So construct a similar
        // clone ourselves...
        const Response = response.constructor;
        const responseCopy = new Response(text, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });

        // Allow grouping by pages.
        entry.pageref = harPageRef || "page_1";
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
          har.log.entries.push(entry);
        }

        if (onHarEntry) {
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
        version: "0.2"
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
