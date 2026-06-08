"""Pipecat bot — Gemini Live + Google Search + memory tools.

Spawned per WebRTC connection by server.py. The bot picks up the persona and
user_id from the connection's request_data, builds a system prompt that
includes whatever it remembers about the user, and runs the Gemini Live
pipeline until the peer disconnects.
"""

from __future__ import annotations

import os
from datetime import datetime

from dotenv import load_dotenv
from loguru import logger

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import AdapterType, ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import EndFrame, LLMRunFrame
from pipecat.transcriptions.language import Language
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.services.google.gemini_live.llm import GeminiLiveLLMService
from pipecat.services.llm_service import LLMService
# NOTE: pipecat.transports.daily is imported lazily inside _run_bot_inner —
# it pulls daily-python, which has no Windows wheel. Keeping the import lazy
# lets the module load (and tests run) on Windows dev machines.

import memory
import personas

# override=True so the project's .env wins over any stray machine/user-level
# env vars (e.g. a leftover GOOGLE_API_KEY in the OS environment shadowing it).
load_dotenv(override=True)


# --- Tool schemas ----------------------------------------------------------

# --- Model selection -------------------------------------------------------

# Default Gemini Live model when nothing is set. Native-audio gives better
# voice quality / lower latency; the older `gemini-live-2.5-flash-preview` is
# the fallback for keys that don't have native-audio access.
GEMINI_DEFAULT_NATIVE_AUDIO = "models/gemini-2.5-flash-native-audio-latest"
GEMINI_DEFAULT_LIVE = "models/gemini-live-2.5-flash-preview"


def _truthy(val: str | None) -> bool:
    return (val or "").strip().lower() in {"1", "true", "yes", "on", "y", "t"}


def resolve_gemini_model() -> tuple[str, str]:
    """Pick the Gemini Live model based on env. Returns (model_id, source).

    Precedence:
      1. GEMINI_LIVE_MODEL — explicit override (full model path), wins.
      2. GEMINI_NATIVE_AUDIO — boolean toggle:
         - true  → native-audio-latest (default, better quality)
         - false → gemini-live-2.5-flash-preview (broadly available)
      3. Default → native-audio-latest.
    """
    explicit = (os.environ.get("GEMINI_LIVE_MODEL") or "").strip()
    if explicit:
        return explicit, "GEMINI_LIVE_MODEL"

    flag = os.environ.get("GEMINI_NATIVE_AUDIO")
    # Default behaviour when unset = native-audio (true).
    use_native = True if flag is None else _truthy(flag)
    if use_native:
        return GEMINI_DEFAULT_NATIVE_AUDIO, "GEMINI_NATIVE_AUDIO=true"
    return GEMINI_DEFAULT_LIVE, "GEMINI_NATIVE_AUDIO=false"


# --- Tool schemas ----------------------------------------------------------

REMEMBER_TOOL = FunctionSchema(
    name="remember",
    description=(
        "Save a single durable fact about the user that should persist across sessions. "
        "Use sparingly — only for things that will matter next time (preferences, ongoing "
        "projects, important people, recurring struggles, goals). Don't store transient "
        "feelings or session-specific details."
    ),
    properties={
        "fact": {
            "type": "string",
            "description": "Short factual statement, e.g. 'Has a daughter named Mira, age 4'.",
        },
        "category": {
            "type": "string",
            "enum": ["identity", "relationships", "work", "health", "goals",
                     "preferences", "history", "general"],
            "description": "Bucket this fact belongs to.",
        },
    },
    required=["fact", "category"],
)

FORGET_TOOL = FunctionSchema(
    name="forget",
    description="Remove stored memories matching a query. Use when the user asks you to forget something.",
    properties={
        "query": {
            "type": "string",
            "description": "Text to match against stored facts (case-insensitive substring).",
        },
    },
    required=["query"],
)


def make_llm(persona, system_instruction: str, gemini_model: str) -> LLMService:
    """Construct the Gemini Live LLM service for this persona.

    The whole pipeline (context aggregator, function-calling, transport) is
    backend-agnostic — only the model + voice strings come from here.
    """
    logger.info(f"[backend] Gemini Live model={gemini_model} voice={persona.voice}")
    return GeminiLiveLLMService(
        api_key=os.environ["GOOGLE_API_KEY"],
        system_instruction=system_instruction,
        tools=build_tools(),
        settings=GeminiLiveLLMService.Settings(
            model=gemini_model,
            voice=persona.voice,
            temperature=0.8,
            # Primes ASR / TTS for Hindi by default. Gemini Live can still
            # transcribe and respond in other languages — the system prompt
            # tells the model to mirror whichever language the user speaks.
            language=Language.HI_IN,
        ),
    )


def build_tools() -> ToolsSchema:
    """Memory tools + Gemini's built-in Google Search grounding."""
    return ToolsSchema(
        standard_tools=[REMEMBER_TOOL, FORGET_TOOL],
        custom_tools={
            # Gemini's native google_search tool — the Gemini adapter recognises this key.
            AdapterType.GEMINI: [{"google_search": {}}],
        },
    )


# --- Bot entrypoint --------------------------------------------------------

async def run_bot(room_url: str, token: str, user_id: str, persona_id: str) -> None:
    try:
        await _run_bot_inner(room_url, token, user_id, persona_id)
    except Exception:
        # Without this, errors inside the spawned task vanish silently —
        # the bot joins the room but never speaks.
        logger.exception(f"Bot crashed for user={user_id} persona={persona_id}")


async def _run_bot_inner(
    room_url: str, token: str, user_id: str, persona_id: str
) -> None:
    persona = personas.get(persona_id)
    model_name, model_source = resolve_gemini_model()
    logger.info(
        f"Starting bot — user={user_id} persona={persona.name} "
        f"voice={persona.voice} model={model_name} (via {model_source})"
    )

    today = datetime.now().strftime("%A, %B %d, %Y")
    memory_block = memory.render_for_prompt(user_id)

    system_instruction = f"""{persona.system_prompt}

Today is {today}.

What you remember about this person:
{memory_block}

When something genuinely worth remembering comes up, call the `remember` tool.
If they ask you to forget something, call `forget`. If they ask a factual
question you don't know, use Google Search rather than guessing.
"""

    from pipecat.transports.daily.transport import DailyParams, DailyTransport

    transport = DailyTransport(
        room_url,
        token,
        "Auralis",
        params=DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            vad_analyzer=SileroVADAnalyzer(),
        ),
    )

    llm = make_llm(persona, system_instruction, model_name)

    # --- function-call handlers -------------------------------------------
    async def handle_remember(params):
        fact = params.arguments.get("fact", "")
        category = params.arguments.get("category", "general")
        try:
            entry = memory.remember(user_id, fact, category)
            logger.info(f"[memory] +{category}: {fact}")
            await params.result_callback({"ok": True, "stored": entry["fact"]})
        except ValueError as e:
            await params.result_callback({"ok": False, "error": str(e)})

    async def handle_forget(params):
        query = params.arguments.get("query", "")
        n = memory.forget(user_id, query)
        logger.info(f"[memory] forget '{query}' -> removed {n}")
        await params.result_callback({"ok": True, "removed": n})

    llm.register_function("remember", handle_remember)
    llm.register_function("forget", handle_forget)

    # Seed an opening user turn so the model is GUARANTEED to greet first.
    # An empty initial context doesn't work: Gemini Live extracts the system
    # prompt out, leaving zero messages, and _create_initial_response() then
    # early-returns without triggering any inference (no greeting). A real
    # trailing user turn forces the first response. This message is context-only
    # (not an ASR transcript), so it never shows up in the captions thread.
    context = LLMContext(
        messages=[
            {
                "role": "user",
                "content": (
                    "(The session just started. Greet me warmly to open the "
                    "conversation — in Hindi by default, by name if you know it "
                    "from memory, and tie it to something you remember about me "
                    "when you can. Keep it short and natural.)"
                ),
            }
        ]
    )
    context_aggregator = LLMContextAggregatorPair(context)

    pipeline = Pipeline([
        transport.input(),
        context_aggregator.user(),
        llm,
        transport.output(),
        context_aggregator.assistant(),
    ])

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=True,
            enable_metrics=True,
        ),
    )

    @transport.event_handler("on_first_participant_joined")
    async def _on_joined(_transport, _participant):
        logger.info("User joined — kicking off greeting")
        # Nudge the model to speak first so the user hears the persona right away.
        await task.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_participant_left")
    async def _on_left(_transport, _participant, _reason):
        logger.info("User left — ending session")
        await task.queue_frames([EndFrame()])

    runner = PipelineRunner(handle_sigint=False)
    await runner.run(task)
