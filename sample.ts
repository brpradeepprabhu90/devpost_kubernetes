import dotenv from "dotenv";               // Library 1: dotenv
import OpenAI from "openai";               // Library 2: openai
import axios from "axios";                 // Library 3: axios
import * as cheerio from "cheerio";        // Library 4: cheerio
import { Client as PgClient } from "pg";   // Library 5: pg (direct DB driver)

// 1. Uncommitted .env file containing master credentials
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Direct DB connection held directly inside the agent loop with admin privileges
const db = new PgClient({
  connectionString: process.env.DATABASE_URL,
});
await db.connect();

// 2. Brittle, massive prompt trying to enforce formatting via English instructions
const SYSTEM_PROMPT = `
You are an autonomous research and action agent.
You have access to the user's PostgreSQL database and the web.
Always reply strictly with JSON in this exact structure:
{"thought": "string", "action": "sql_query" | "search" | "finish", "param": "string"}
Never delete tables. Be safe.
`;

const conversationHistory: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: "Check recent high-risk sensory alerts in our DB and look up soothing techniques." },
];

// 3. The unbounded while loop (The anti-pattern)
let isRunning = true;

while (isRunning) {
  console.log("Dispatching prompt to LLM...");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: conversationHistory,
    temperature: 0.7,
  });

  const reply = completion.choices[0].message.content ?? "";
  console.log("Raw LLM Reply:", reply);

  conversationHistory.push({ role: "assistant", content: reply });

  // 4. Brittle deserialization: will crash if LLM outputs markdown formatting or prose
  let parsed: { thought: string; action: string; param: string };
  try {
    parsed = JSON.parse(reply);
  } catch (err) {
    console.error("Crash: Model emitted non-JSON output!", err);
    throw err;
  }
  if (parsed.action === "sql_query") {
    console.log(`Executing raw SQL: ${parsed.param}`);
    const queryResult = await db.query(parsed.param);
    conversationHistory.push({
      role: "user",
      content: `DB Result: ${JSON.stringify(queryResult.rows)}`,
    });
  } else if (parsed.action === "search") {
    console.log(`Scraping web: ${parsed.param}`);
    const response = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(parsed.param)}`);
    const $ = cheerio.load(response.data);
    const snippet = $(".result__snippet").first().text() || "No snippet found";
    
    conversationHistory.push({
      role: "user",
      content: `Web Result: ${snippet}`,
    });
  } else if (parsed.action === "finish") {
    console.log("Agent finished execution:", parsed.param);
    isRunning = false;
  }
}

await db.end();