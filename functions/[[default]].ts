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
  const originalPathname = url.pathname;
  url.hostname = "wallhaven.cc"; // 此处替换为要反代的域名

  // 调试：记录请求信息
  const isDebugMode = url.searchParams.has('debug');

  // 特殊处理：确保CSS文件请求不被重定向
  const isCssRequest = originalPathname.toLowerCase().endsWith('.css') ||
    originalPathname.toLowerCase().includes('.css?') ||
    originalPathname.toLowerCase().includes('.min.css');

  if (isDebugMode) {
    return new Response(JSON.stringify({
      originalUrl: request.url,
      targetUrl: url.toString(),
      pathname: originalPathname,
      isCssRequest,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries())
    }, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

  // 请求头处理，去除可能导致错误的 headers
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("Accept-Encoding");

  // 对于CSS文件，确保正确的Accept头
  if (isCssRequest) {
    headers.set("Accept", "text/css,*/*;q=0.1");
    headers.set("Sec-Fetch-Dest", "style");
    headers.set("Sec-Fetch-Mode", "no-cors");
    headers.set("Sec-Fetch-Site", "cross-site");
  }

  // 请求体处理，仅在允许的情况下传递 body
  const method = request.method.toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(method);

  // 生成回源请求
  const req = new Request(url.toString(), {
    method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: "manual", // 手动处理重定向，避免CSS被重定向到HTML页面
  });

  try {
    // 发起请求，返回只读属性的响应
    let response = await fetch(req);

    // 处理重定向（特别针对CSS文件）
    if (isCssRequest && (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308)) {
      const location = response.headers.get('location');
      if (location) {
        // 如果是相对路径，转为绝对路径
        const redirectUrl = location.startsWith('http') ? location : `https://wallhaven.cc${location}`;
        const redirectReq = new Request(redirectUrl, {
          method: "GET",
          headers: headers,
          redirect: "manual"
        });
        response = await fetch(redirectReq);
      }
    }

    // 获取请求路径和内容类型，用于判断文件类型
    const pathname = url.pathname.toLowerCase();
    const originalContentType = response.headers.get("content-type") || "";

    // 检查CSS文件是否返回了错误的内容类型
    if (isCssRequest && (originalContentType.includes("text/html") || originalContentType.includes("application/json"))) {
      // CSS请求返回了HTML或JSON，返回错误信息
      return new Response(
        JSON.stringify({
          error: "CSS file returned wrong content type",
          expectedType: "text/css",
          actualType: originalContentType,
          url: url.toString(),
          status: response.status,
          headers: Object.fromEntries(response.headers.entries())
        }, null, 2),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }

    // 判断是否为CSS或JS文件
    const isCssFile = originalContentType.includes("text/css") ||
      pathname.endsWith(".css") ||
      pathname.includes(".css?") ||
      pathname.includes("/css/") ||
      pathname.includes(".min.css");

    const isJsFile = originalContentType.includes("text/javascript") ||
      originalContentType.includes("application/javascript") ||
      pathname.endsWith(".js") ||
      pathname.includes(".js?") ||
      pathname.includes("/js/") ||
      pathname.includes(".min.js");

    // 创建新的响应头，复制原始响应的头信息
    const responseHeaders = new Headers();

    // 首先设置强制CORS响应头
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD");
    responseHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Origin, User-Agent, Cache-Control, Pragma");
    responseHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Type, Cache-Control, ETag, Last-Modified");

    // 为CSS和JS文件设置额外的跨域头
    if (isCssFile || isJsFile) {
      responseHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
      responseHeaders.set("Cross-Origin-Embedder-Policy", "unsafe-none");
      responseHeaders.set("Cross-Origin-Opener-Policy", "unsafe-none");
      // 确保CSS文件有正确的Content-Type
      if (isCssFile && !originalContentType.includes("text/css")) {
        responseHeaders.set("Content-Type", "text/css; charset=utf-8");
      }
    }

    // 然后复制原始响应的头信息（除了可能冲突的安全头）
    for (const [key, value] of response.headers.entries()) {
      const lowerKey = key.toLowerCase();
      // 跳过可能导致CORS问题的头
      if (lowerKey === "x-frame-options" ||
        lowerKey === "content-security-policy" ||
        lowerKey === "x-content-type-options" ||
        lowerKey.startsWith("access-control-")) {
        continue;
      }
      // 对于CSS/JS文件，不覆盖我们已经设置的Content-Type
      if ((isCssFile || isJsFile) && lowerKey === "content-type") {
        continue;
      }
      responseHeaders.set(key, value);
    }

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
