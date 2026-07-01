import { NextRequest, NextResponse } from "next/server";

const IAM_BASE_URL = process.env.NEXT_PUBLIC_IAM_BASE_URL || "https://id.item.com";

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
    }

    const res = await fetch(`${IAM_BASE_URL}/auth/exchange-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "password", username, password }),
    });

    const text = await res.text();

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
      }
      return NextResponse.json({ error: "Unable to sign in. Please try again later." }, { status: 502 });
    }

    let json: { code?: number | string; msg?: string; data?: { access_token?: string; refresh_token?: string } };
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Unexpected response from authentication service." }, { status: 502 });
    }

    if (String(json.code) !== "0") {
      return NextResponse.json({ error: json.msg || "Invalid username or password." }, { status: 401 });
    }

    if (!json.data?.access_token) {
      return NextResponse.json({ error: "Sign-in succeeded but no session was returned." }, { status: 502 });
    }

    return NextResponse.json({ token: json.data.access_token });
  } catch {
    return NextResponse.json({ error: "Unable to reach the authentication service." }, { status: 502 });
  }
}
