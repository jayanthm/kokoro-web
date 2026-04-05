import { json } from "@sveltejs/kit";
import zod from "zod";
import { fromError } from "zod-validation-error";
import type { RequestHandler } from "./$types";
import { generateVoice, generateVoiceStream } from "$lib/shared/kokoro";
import { voicesMap } from "$lib/shared/resources";
import { authenticate } from "$lib/server/authenticate";

const PINNED_VOICE_FORMULA = "af_heart";
const PINNED_MODEL = "model";

/**
 * @openapi
 * /api/v1/audio/speech:
 *   post:
 *     summary: Generate audio from the input text
 *     description: >
 *       This endpoint is compatible with the OpenAI API.
 *
 *
 *       Python Example:
 *
 *           from pathlib import Path
 *           from openai import OpenAI
 *
 *           client = OpenAI(
 *               base_url="http://localhost:5173/api/v1",
 *               api_key="no-key",
 *           )
 *
 *           speech_file_path = Path(__file__).parent / "speech.wav"
 *           response = client.audio.speech.create(
 *               model="model",
 *               voice="af_heart",
 *               input="Today is a wonderful day to build something people love!",
 *               response_format="wav",
 *           )
 *
 *           response.stream_to_file(speech_file_path)
 *
 *       JavaScript Example:
 *
 *           import fs from "fs";
 *           import path from "path";
 *           import OpenAI from "openai";
 *
 *           const openai = new OpenAI({
 *             baseURL: "http://localhost:5173/api/v1",
 *             apiKey: "no-key",
 *           });
 *           const speechFile = path.resolve("./speech.wav");
 *
 *           const wav = await openai.audio.speech.create({
 *             model: "model",
 *             voice: "af_heart",
 *             input: "Today is a wonderful day to build something people love!",
 *             response_format: "wav",
 *           });
 *
 *           const buffer = Buffer.from(await wav.arrayBuffer());
 *           await fs.promises.writeFile(speechFile, buffer);
 *
 *       Notes:
 *
 *           • Synthesis is pinned server-side to voice "af_heart" and model "model".
 *           • `response_format=wav` is streamed for low-latency playback.
 *           • `response_format=mp3` remains buffered (non-streaming).
 *
 *     tags:
 *       - Speech
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               model:
 *                 type: string
 *                 description: Ignored. Synthesis uses server-pinned model `model`.
 *               voice:
 *                 type: string
 *                 description: Ignored. Synthesis uses server-pinned voice `af_heart`.
 *               input:
 *                 type: string
 *                 description: Input text to synthesize
 *               response_format:
 *                 type: string
 *                 enum: [mp3, wav]
 *                 default: wav
 *                 description: Response format. WAV responses are streamed; MP3 is buffered.
 *               speed:
 *                 type: number
 *                 minimum: 0.25
 *                 maximum: 5
 *                 default: 1
 *                 description: Speed of the synthesis
 *     responses:
 *       200:
 *         description: Audio file with the synthesized speech
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: Error message
 *             example:
 *               message: "Validation error ..."
 */

const schema = zod.object({
  model: zod.string().optional(),
  voice: zod.string().optional(),
  input: zod.string(),
  response_format: zod.enum(["mp3", "wav"]).default("wav").optional(),
  speed: zod.number().min(0.25).max(5).default(1).optional(),
});

export const POST: RequestHandler = async ({ request }) => {
  try {
    authenticate(request);
  } catch (e: any) {
    return json({ message: e.message }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json());

  if (!parsed.success) {
    return json(
      { message: fromError(parsed.error).toString() },
      { status: 400 },
    );
  }

  const { input, speed, response_format } = parsed.data;

  const lang = voicesMap["af_heart"].lang;

  try {
    if ((response_format ?? "wav") === "wav") {
      const readable = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const chunk of generateVoiceStream({
              text: input,
              lang: lang.id,
              voiceFormula: PINNED_VOICE_FORMULA,
              model: PINNED_MODEL,
              speed: speed ?? 1,
              acceleration: "cpu",
            })) {
              controller.enqueue(chunk);
            }
            controller.close();
          } catch (e) {
            controller.error(e);
          }
        },
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "audio/wav",
          "Transfer-Encoding": "chunked",
        },
      });
    }

    const result = await generateVoice({
      text: input,
      lang: lang.id,
      voiceFormula: PINNED_VOICE_FORMULA,
      model: PINNED_MODEL,
      speed: speed ?? 1,
      format: "mp3",
      acceleration: "cpu",
    });

    return new Response(result.buffer, {
      headers: {
        "Content-Type": result.mimeType,
      },
    });
  } catch (e: any) {
    return json({ message: e.message }, { status: 500 });
  }
};
