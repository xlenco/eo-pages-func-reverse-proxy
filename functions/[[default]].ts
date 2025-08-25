interface GeoProperties {
  asn: number;
  countryName: string;
  countryCodeAlpha2: string;
  countryCodeAlpha3: string;
  countryCodeNumeric: string;
  regionName: string;
  regionCode: string;
  cityName: string;
  latitude: number;
  longitude: number;
  cisp: string;
}

interface IncomingRequestEoProperties {
  geo: GeoProperties;
  uuid: string;
  clientIp: string;
}

interface EORequest extends Request {
  readonly eo: IncomingRequestEoProperties;
}

// 处理 OPTIONS 预检请求
export async function onRequestOptions() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin, User-Agent, Cache-Control, Pragma",
      "Access-Control-Max-Age": "86400", // 24小时预检缓存
      "Vary": "Origin",
    },
  });
}

// 处理所有请求
export async function onRequest({ request }: { request: EORequest }) {
  // 处理 URL
  const url = new URL(request.url);
  url.hostname = "wallhaven.cc"; // 此处替换为要反代的域名

  // 请求头处理，去除可能导致错误的 headers
  const headers = new Headers(request.headers);
  // 如果不知道有什么，可以取消注释以下内容：
  // return new Response(JSON.stringify(headers));
  headers.delete("host");
  headers.delete("Accept-Encoding");

  // 请求体处理，仅在允许的情况下传递 body
  const method = request.method.toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(method);

  // 生成回源请求
  const req = new Request(url.toString(), {
    method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: "follow",
  });

  try {
    // 发起请求，返回只读属性的响应
    const response = await fetch(req);

    // 创建新的响应头，复制原始响应的头信息
    const responseHeaders = new Headers(response.headers);

    // 设置CORS响应头
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD");
    responseHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Origin, User-Agent, Cache-Control, Pragma");
    responseHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Type, Cache-Control, ETag, Last-Modified");

    // 处理内容类型相关的CORS设置
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/css") || contentType.includes("text/javascript") || contentType.includes("application/javascript")) {
      responseHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
    }

    // 移除可能导致CORS问题的头
    responseHeaders.delete("x-frame-options");
    responseHeaders.delete("content-security-policy");

    // 创建新响应
    const newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });

    // 返回响应
    return newResponse;
  } catch (e: any) {
    // 返回错误
    return new Response(
      JSON.stringify({ error: e?.message || String(e), url: url.toString() }),
      {
        status: 502,
        headers: {
          "content-type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin, User-Agent, Cache-Control, Pragma",
        },
      }
    );
  }
}
