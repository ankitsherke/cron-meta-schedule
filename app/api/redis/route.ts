import { NextResponse } from "next/server";
import { getRedisClient } from "../../../lib/redis";

export async function GET() {
  const client = await getRedisClient();
  const value = await client.get("myKey");
  return NextResponse.json({ value });
}
