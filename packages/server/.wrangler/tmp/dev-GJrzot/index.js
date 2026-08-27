var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
import { DurableObject } from "cloudflare:workers";

// ../../node_modules/.pnpm/nanoid@6.0.1/node_modules/nanoid/index.browser.js
var random = /* @__PURE__ */ __name((bytes) => crypto.getRandomValues(new Uint8Array(bytes)), "random");
var customRandom = /* @__PURE__ */ __name((alphabet, defaultSize, getRandom) => {
  let safeByteCutoff = 256 - 256 % alphabet.length;
  if (safeByteCutoff === 256) {
    let mask = alphabet.length - 1;
    return (size = defaultSize) => {
      if (!size) return "";
      let id = "";
      while (true) {
        let bytes = getRandom(size);
        let j = size;
        while (j--) {
          id += alphabet[bytes[j] & mask];
          if (id.length >= size) return id;
        }
      }
    };
  }
  let step = Math.ceil(1.6 * 256 * defaultSize / safeByteCutoff);
  return (size = defaultSize) => {
    if (!size) return "";
    let id = "";
    while (true) {
      let bytes = getRandom(step);
      let j = step;
      while (j--) {
        if (bytes[j] < safeByteCutoff) {
          id += alphabet[bytes[j] % alphabet.length];
          if (id.length >= size) return id;
        }
      }
    }
  };
}, "customRandom");
var customAlphabet = /* @__PURE__ */ __name((alphabet, size = 21) => customRandom(alphabet, size | 0, random), "customAlphabet");

// src/index.ts
var ROOM_CAPACITY = 2;
var newRoomCode = customAlphabet("0123456789", 4);
var CONTROL_PREFIX = "#";
var RELAY_PREFIX = ">";
var ROOM_OK = `${CONTROL_PREFIX}room:ok`;
var PEER_JOINED = `${CONTROL_PREFIX}peer:joined`;
var PEER_LEFT = `${CONTROL_PREFIX}peer:left`;
var CLOSE_BAD_ROLE = 4e3;
var CLOSE_NO_ROOM = 4001;
var CLOSE_ROOM_FULL = 4002;
var CLOSE_ROOM_TAKEN = 4003;
function rejectUpgrade(code, reason) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}
__name(rejectUpgrade, "rejectUpgrade");
var Room = class extends DurableObject {
  static {
    __name(this, "Room");
  }
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }
  /**
   * 房里现在几个人。Worker 摇房间码时用 RPC 调它来判断这个码空不空。
   */
  occupancy() {
    return this.ctx.getWebSockets().length;
  }
  async fetch(request) {
    const role = new URL(request.url).searchParams.get("role");
    if (role !== "host" && role !== "guest") {
      return rejectUpgrade(CLOSE_BAD_ROLE, "role \u53C2\u6570\u5FC5\u987B\u662F host \u6216 guest");
    }
    const peers = this.ctx.getWebSockets();
    if (role === "host") {
      if (peers.length > 0) return rejectUpgrade(CLOSE_ROOM_TAKEN, "\u623F\u95F4\u5DF2\u88AB\u5360\u7528");
    } else {
      if (peers.length === 0) return rejectUpgrade(CLOSE_NO_ROOM, "\u623F\u95F4\u4E0D\u5B58\u5728");
      if (peers.length >= ROOM_CAPACITY) return rejectUpgrade(CLOSE_ROOM_FULL, "\u623F\u95F4\u5DF2\u6EE1");
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [role]);
    server.send(ROOM_OK);
    for (const peer of peers) peer.send(PEER_JOINED);
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, message) {
    const peer = this.peerOf(ws);
    if (!peer) return;
    peer.send(typeof message === "string" ? RELAY_PREFIX + message : message);
  }
  async webSocketClose(ws) {
    this.notifyPeerLeft(ws);
  }
  async webSocketError(ws) {
    this.notifyPeerLeft(ws);
  }
  notifyPeerLeft(ws) {
    this.peerOf(ws)?.send(PEER_LEFT);
  }
  /**
   * 房里的另一个人。
   *
   * 容量是 2，所以除自己之外最多只剩一个。每次都重新查 getWebSockets() 而不是维护一张表，
   * 是因为这份列表由运行时保管，DO 休眠再醒来依然完整，而内存里的表会丢。
   * 关闭回调触发时自己可能还在这份列表里，所以要显式排除。
   */
  peerOf(ws) {
    return this.ctx.getWebSockets().find((other) => other !== ws);
  }
};
async function createRoom(env) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = newRoomCode();
    if (await env.ROOM.getByName(code).occupancy() === 0) {
      return Response.json({ code });
    }
  }
  return Response.json({ error: "\u623F\u95F4\u7801\u6447\u4E0D\u51FA\u6765\u4E86\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5" }, { status: 503 });
}
__name(createRoom, "createRoom");
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/room") return createRoom(env);
    const roomPath = /^\/room\/(\d{4})\/?$/.exec(url.pathname);
    const isUpgrade = request.headers.get("Upgrade")?.toLowerCase() === "websocket";
    if (roomPath && isUpgrade) {
      return env.ROOM.getByName(roomPath[1]).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

// ../../node_modules/.pnpm/wrangler@4.127.0_@cloudflare+workers-types@5.20260827.1/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../node_modules/.pnpm/wrangler@4.127.0_@cloudflare+workers-types@5.20260827.1/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-TgS28M/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../node_modules/.pnpm/wrangler@4.127.0_@cloudflare+workers-types@5.20260827.1/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-TgS28M/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  Room,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
