export function publicCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export function publicJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: publicCorsHeaders() });
}

export function publicOptions() {
  return new Response(null, { status: 204, headers: publicCorsHeaders() });
}
