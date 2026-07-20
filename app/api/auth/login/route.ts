import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const iamBaseUrl = process.env.IAM_BASE_URL;
  if (!iamBaseUrl) {
    return Response.json(
      { success: false, message: "IAM service not configured" },
      { status: 500 }
    );
  }

  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, message: "Invalid request body" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(`${iamBaseUrl}/auth/exchange-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "password",
        username: body.username,
        password: body.password,
      }),
    });

    const json = await res.json();

    if (String(json.code) !== "0" || !json.data?.access_token) {
      console.error("[auth/login] IAM rejected:", json.code, json.msg || json.message);
      return Response.json(
        { success: false, message: json.msg || json.message || "Invalid credentials" },
        { status: 401 }
      );
    }

    return Response.json({ success: true, data: json.data });
  } catch (err) {
    console.error("[auth/login] IAM unreachable:", err);
    return Response.json(
      { success: false, message: "Authentication service unavailable" },
      { status: 502 }
    );
  }
}
