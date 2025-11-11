import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

// Initialize DynamoDB
const dynamo = new DynamoDBClient({});

// Environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!;
const SPOTIFY_ACCESS_TOKEN = process.env.SPOTIFY_ACCESS_TOKEN!;
const TABLE_NAME = process.env.TABLE_NAME!;

// Interfaces
interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
}

interface SpotifyUser {
  id: string;
}

interface SpotifyPlaylist {
  id: string;
  external_urls: { spotify: string };
}

interface SpotifySearch {
  tracks?: {
    items?: { uri?: string; name: string; artists: { name: string }[] }[];
  };
}

// 🧹 Sanitizers
function cleanGeminiJson(rawText: string): string {
  return rawText
    .replace(/```json/i, "") // remove ```json or ```JSON
    .replace(/```/g, "")     // remove closing ```
    .trim();
}

function extractJsonArray(text: string): string {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array found");
  return text.slice(start, end + 1);
}

// 🧽 Normalize titles and artists for Spotify search
function normalize(str: string): string {
  return str.replace(/[’']/g, "").replace(/\s+/g, " ").trim();
}

// 🚀 Lambda handler
export const handler = async (event: any) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { userId = "testuser", prompt = "Create a chill study playlist" } = body;
    console.log("📥 Received prompt:", prompt);

    // 1️⃣ Ask Gemini for songs
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `You are a playlist curator. Generate exactly 10 songs that match this description: "${prompt}". Respond ONLY with a valid JSON array, nothing else.
                  Format: [{"title": "Song title", "artist": "Artist name"}]`,
                },
              ],
            },
          ],
        }),
      }
    );

    console.log("Gemini status:", geminiResponse.status);
const geminiJson = (await geminiResponse.json()) as GeminiResponse;
const rawText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text || "";
console.log("🧠 Gemini text field:", rawText);

if (!rawText) throw new Error("Gemini API returned no text output.");

let songs: { title: string; artist: string }[] = [];
try {
  songs = JSON.parse(rawText);
} catch {
  console.warn("⚠️ Gemini output not pure JSON, attempting extraction...");
  try {
    songs = JSON.parse(extractJsonArray(cleanGeminiJson(rawText)));
  } catch (err) {
    console.error("❌ Failed to sanitize Gemini output:", err, rawText);
    throw new Error("Gemini output was not JSON");
  }
}


    console.log("🎵 Gemini suggested songs:", songs);

    // 2️⃣ Get Spotify user
    const userRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${SPOTIFY_ACCESS_TOKEN}` },
    });

    if (!userRes.ok) {
      const errorText = await userRes.text();
      throw new Error(`Spotify user fetch failed: ${errorText}`);
    }

    const userData = (await userRes.json()) as SpotifyUser;
    console.log("Spotify user ID:", userData.id);

    // 3️⃣ Create Spotify playlist
    const playlistRes = await fetch(`https://api.spotify.com/v1/users/${userData.id}/playlists`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SPOTIFY_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `Gemini: ${prompt}`,
        description: "AI-generated playlist",
        public: true,
      }),
    });

    if (!playlistRes.ok) {
      const errorText = await playlistRes.text();
      throw new Error(`Spotify playlist creation failed: ${errorText}`);
    }

    const playlistData = (await playlistRes.json()) as SpotifyPlaylist;
    console.log("✅ Created playlist:", playlistData.external_urls.spotify);

    // 4️⃣ Search for songs and add to playlist
    console.log(`🔁 Starting Spotify search for ${songs.length} songs...`);
    for (const song of songs) {
      try {
        const query = encodeURIComponent(`${normalize(song.title)} ${normalize(song.artist)}`);
        console.log("🔍 Query:", `${song.title} ${song.artist}`);

        const searchRes = await fetch(
          `https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`,
          { headers: { Authorization: `Bearer ${SPOTIFY_ACCESS_TOKEN}` } }
        );

        const text = await searchRes.text();
        console.log("Spotify raw search:", text);

        if (!searchRes.ok) {
          console.error("❌ Spotify search failed:", searchRes.status, text);
          continue;
        }

        const searchData = JSON.parse(text) as SpotifySearch;
        const item = searchData.tracks?.items?.[0];
        if (!item) {
          console.warn("⚠️ No match for:", song);
          continue;
        }

        console.log(
          "🎯 Match found:",
          item.name,
          "by",
          item.artists.map((a: { name: string }) => a.name).join(",")
        );
        console.log("URI:", item.uri);

        // Add track to playlist
        const addRes = await fetch(
          `https://api.spotify.com/v1/playlists/${playlistData.id}/tracks`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SPOTIFY_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ uris: [item.uri] }),
          }
        );

        if (!addRes.ok) {
          const addText = await addRes.text();
          console.error("❌ Failed to add track:", addText);
        } else {
          console.log(`✅ Added track: ${song.title}`);
        }
      } catch (err) {
        console.error("Error searching or adding song:", song, err);
      }
    }

    // 5️⃣ Save playlist info to DynamoDB
    try {
      await dynamo.send(
        new UpdateItemCommand({
          TableName: TABLE_NAME,
          Key: { userId: { S: userId } },
          UpdateExpression: "SET lastPrompt = :p, lastPlaylist = :l",
          ExpressionAttributeValues: {
            ":p": { S: prompt },
            ":l": { S: playlistData.external_urls.spotify || "none" },
          },
        })
      );
      console.log("🪣 Saved playlist info to DynamoDB for user:", userId);
    } catch (err) {
      console.error("❌ Failed to save to DynamoDB:", err);
    }

    // ✅ Return success
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Playlist created successfully!",
        playlistUrl: playlistData.external_urls.spotify,
        songs,
      }),
    };
  } catch (err: any) {
    console.error("💥 Uncaught error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message || "Internal Server Error",
      }),
    };
  }
};




