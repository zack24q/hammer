const vm = require('node:vm');
const { installBilibiliLivePage } = require('../../src/main/bilibiliLivePage.ts');

function livePageFixture(
  fetch = async () => new Response('{"code":0,"data":{}}'),
  origin = 'https://link.bilibili.com'
) {
  const events = [];
  class XHR extends EventTarget {
    open(method, url) {
      this.method = method;
      this.url = url;
      this.headers = {};
      this.readyState = 1;
    }
    send(body) {
      this.body = body;
    }
    setRequestHeader(name, value) {
      name = name.toLowerCase();
      this.headers[name] = this.headers[name] ? `${this.headers[name]}, ${value}` : value;
    }
    get responseText() {
      return this.rawText || '';
    }
    get response() {
      return this.rawResponse ?? null;
    }
    finish(payload, responseType = '') {
      this.rawText = JSON.stringify(payload);
      this.rawResponse = payload;
      this.readyState = 4;
      this.responseType = responseType;
      this.dispatchEvent(new Event('load'));
    }
  }
  const window = { fetch, hammerLivePage: { sign: () => 'test-sign', publish: event => events.push(event) } };
  vm.runInNewContext(`(${installBilibiliLivePage.toString()})()`, {
    window,
    location: { origin, href: `${origin}/p/center/index` },
    XMLHttpRequest: XHR,
    URL,
    URLSearchParams,
    FormData,
    Request,
    Response,
    Headers,
    document: { addEventListener() {} },
  });
  return { XHR, window, events };
}
module.exports = { livePageFixture };
