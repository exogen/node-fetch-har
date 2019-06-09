const { withHar, createHarLog } = require("./index");

describe("withHar", () => {
  describe.each(["node-fetch", "isomorphic-fetch", "isomorphic-unfetch"])(
    "using %s",
    fetchModule => {
      const baseFetch = require(fetchModule);

      describe("fetch", () => {
        it("adds harEntry to responses", async () => {
          const fetch = withHar(baseFetch);
          const response = await fetch(
            "https://postman-echo.com/get?foo1=bar1&foo2=bar2",
            {
              compress: false,
              headers: {
                Cookie: "token=12345; other=abcdef"
              }
            }
          );
          expect(response.headers.get("content-type")).toBe(
            "application/json; charset=utf-8"
          );
          expect(response.harEntry).toEqual({
            _timestamps: expect.any(Object),
            startedDateTime: expect.stringMatching(
              /^\d\d\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z$/
            ),
            time: expect.any(Number),
            timings: {
              blocked: 0.01,
              connect: -1,
              dns: -1,
              receive: expect.any(Number),
              send: expect.any(Number),
              ssl: -1,
              wait: expect.any(Number)
            },
            cache: {
              afterRequest: null,
              beforeRequest: null
            },
            pageref: "page_1",
            request: {
              bodySize: -1,
              cookies: [
                { name: "token", value: "12345" },
                { name: "other", value: "abcdef" }
              ],
              headers: expect.arrayContaining([
                {
                  name: expect.stringMatching(/^cookie$/i),
                  value: "token=12345; other=abcdef"
                },
                {
                  name: "x-har-request-id",
                  value: expect.any(String)
                },
                {
                  name: expect.stringMatching(/^accept$/i),
                  value: "*/*"
                },
                {
                  name: expect.stringMatching(/^user-agent$/i),
                  value:
                    "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)"
                }
              ]),
              headersSize: -1,
              httpVersion: "HTTP/1.1",
              method: "GET",
              queryString: [
                {
                  name: "foo1",
                  value: "bar1"
                },
                {
                  name: "foo2",
                  value: "bar2"
                }
              ],
              url: "https://postman-echo.com/get?foo1=bar1&foo2=bar2"
            },
            response: {
              httpVersion: "HTTP/1.1",
              status: 200,
              statusText: "OK",
              redirectURL: "",
              headersSize: -1,
              bodySize: expect.any(Number),
              content: {
                mimeType: "application/json; charset=utf-8",
                size: expect.any(Number),
                text: expect.any(String)
              },
              cookies: expect.any(Array),
              headers: expect.arrayContaining([
                {
                  name: "Content-Type",
                  value: "application/json; charset=utf-8"
                },
                {
                  name: "Date",
                  value: expect.any(String)
                },
                {
                  name: "Vary",
                  value: "Accept-Encoding"
                },
                {
                  name: "Content-Length",
                  value: expect.any(String)
                },
                {
                  name: "Connection",
                  value: "Close"
                }
              ])
            }
          });
          const body = await response.json();
          expect(body).toEqual({
            args: {
              foo1: "bar1",
              foo2: "bar2"
            },
            headers: {
              accept: "*/*",
              cookie: "token=12345; other=abcdef",
              host: "postman-echo.com",
              "user-agent":
                "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)",
              "x-forwarded-port": "443",
              "x-forwarded-proto": "https",
              "x-har-request-id": expect.any(String)
            },
            url: "https://postman-echo.com/get?foo1=bar1&foo2=bar2"
          });
        });

        it("reports entries with the onHarEntry option", async () => {
          const onHarEntry = jest.fn();
          const fetch = withHar(baseFetch);
          await fetch("https://postman-echo.com/get", { onHarEntry });
          expect(onHarEntry).toHaveBeenCalledWith(
            expect.objectContaining({
              request: expect.objectContaining({
                url: "https://postman-echo.com/get"
              })
            })
          );
        });

        it("adds entries to the given log created with createHarLog", async () => {
          const har = createHarLog();
          const har2 = createHarLog();
          const fetch = withHar(baseFetch);
          await Promise.all([
            fetch("https://postman-echo.com/stream/5", { har }),
            fetch("https://postman-echo.com/delay/2", { har: har2 }),
            fetch("https://postman-echo.com/deflate", { har })
          ]);
          expect(har.log.entries).toHaveLength(2);
          expect(har2.log.entries).toHaveLength(1);
        });

        it("does not record entries if har option is false", async () => {
          const onHarEntry = jest.fn();
          const fetch = withHar(baseFetch);
          const response = await fetch("https://postman-echo.com/get", {
            har: false,
            onHarEntry
          });
          expect(onHarEntry).not.toHaveBeenCalled();
          expect(response).not.toHaveProperty("harEntry");
        });

        it("supports large request and response bodies", async () => {
          const fetch = withHar(baseFetch);
          const response = await fetch("https://graphbrainz.herokuapp.com/", {
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
          const body = await response.json();
          expect(body).toMatchObject({
            data: {
              __schema: expect.any(Object)
            }
          });
        });
      });

      it("reports entries with the onHarEntry option", async () => {
        const onHarEntry = jest.fn();
        const fetch = withHar(baseFetch, { onHarEntry });
        await fetch("https://postman-echo.com/get");
        expect(onHarEntry).toHaveBeenCalledWith(
          expect.objectContaining({
            request: expect.objectContaining({
              url: "https://postman-echo.com/get"
            })
          })
        );
      });

      it("adds entries to the given log created with createHarLog", async () => {
        const har = createHarLog();
        const fetch = withHar(baseFetch, { har });
        await Promise.all([
          fetch("https://postman-echo.com/stream/5"),
          fetch("https://postman-echo.com/delay/2"),
          fetch("https://postman-echo.com/deflate")
        ]);
        expect(har.log.entries).toHaveLength(3);
      });
    }
  );
});
