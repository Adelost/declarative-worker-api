"""
OpenAI LLM tasks.

Uses standard ChatPayload - same as Qwen, Llama, etc.
"""

from typing import Generator
import json

from ..decorator import task

# Standard schema - samma för alla providers!
from ...schemas.chat import ChatPayload, ChatResponse


@task(
    name="openai.chat",
    tags=["text", "ai", "generate"],
    gpu=None,  # OpenAI är API-baserat
    timeout=120,
)
def chat(payload: ChatPayload) -> ChatResponse:
    """
    Chat completion using OpenAI API.

    Accepterar standard ChatPayload - samma som qwen.chat!
    """
    import openai

    # Konvertera Pydantic -> OpenAI format
    messages = [{"role": m.role, "content": m.content} for m in payload.messages]

    response = openai.chat.completions.create(
        model="gpt-4",
        messages=messages,
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
        top_p=payload.top_p,
        stop=payload.stop,
    )

    return ChatResponse(
        content=response.choices[0].message.content,
        model=response.model,
        usage={
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
            "total_tokens": response.usage.total_tokens,
        },
    )


@task(
    name="openai.chat_stream",
    tags=["text", "ai", "generate"],
    gpu=None,
    timeout=120,
    streaming=True,
)
def chat_stream(payload: ChatPayload) -> Generator[ChatResponse, None, None]:
    """Streaming chat completion."""
    import openai

    messages = [{"role": m.role, "content": m.content} for m in payload.messages]

    response = openai.chat.completions.create(
        model="gpt-4",
        messages=messages,
        temperature=payload.temperature,
        stream=True,
    )

    for chunk in response:
        if chunk.choices[0].delta.content:
            yield ChatResponse(
                content=chunk.choices[0].delta.content,
                model="gpt-4",
                is_partial=True,
            )


@task(
    name="openai.embed",
    tags=["text", "ai", "generate"],
    gpu=None,
    timeout=60,
)
def embed(
    text: str | list[str],
    model: str = "text-embedding-3-small",
) -> list[float] | list[list[float]]:
    """Generate embeddings for text."""
    import openai

    response = openai.embeddings.create(model=model, input=text)

    if isinstance(text, str):
        return response.data[0].embedding
    return [d.embedding for d in response.data]


@task(
    name="openai.summarize",
    tags=["text", "ai", "generate"],
    gpu=None,
    timeout=120,
)
def summarize(text: str, max_length: int = 200, style: str = "concise") -> str:
    """Summarize text using LLM."""
    from ...schemas.chat import Message

    prompts = {
        "concise": f"Summarize in {max_length} chars or less:\n\n{text}",
        "detailed": f"Detailed summary (target: {max_length} chars):\n\n{text}",
        "bullet": f"Summarize as bullet points:\n\n{text}",
    }

    payload = ChatPayload(
        messages=[Message(role="user", content=prompts.get(style, prompts["concise"]))],
        temperature=0.3,
    )

    result = chat(payload)
    return result.content


@task(
    name="openai.extract",
    tags=["text", "ai", "generate"],
    gpu=None,
    timeout=120,
)
def extract(text: str, schema: dict) -> dict:
    """Extract structured data from text."""
    from ...schemas.chat import Message

    prompt = f"""Extract information according to this JSON schema:

Schema:
{json.dumps(schema, indent=2)}

Text:
{text}

Respond with valid JSON only."""

    payload = ChatPayload(
        messages=[Message(role="user", content=prompt)],
        temperature=0,
    )

    result = chat(payload)
    return json.loads(result.content)


@task(
    name="openai.classify",
    tags=["text", "ai", "generate"],
    gpu=None,
    timeout=60,
)
def classify(text: str, categories: list[str]) -> dict:
    """Classify text into categories."""
    from ...schemas.chat import Message

    categories_str = ", ".join(categories)
    prompt = f"""Classify into one of: {categories_str}

Text: {text}

Respond with JSON: {{"category": "...", "confidence": 0.0-1.0, "reasoning": "..."}}"""

    payload = ChatPayload(
        messages=[Message(role="user", content=prompt)],
        temperature=0,
    )

    result = chat(payload)
    return json.loads(result.content)


@task(
    name="openai.translate",
    tags=["text", "ai", "generate"],
    gpu=None,
    timeout=120,
)
def translate(text: str, target_language: str, source_language: str = None) -> str:
    """Translate text."""
    from ...schemas.chat import Message

    source = f"from {source_language} " if source_language else ""
    prompt = f"Translate {source}to {target_language}. Only output the translation:\n\n{text}"

    payload = ChatPayload(
        messages=[Message(role="user", content=prompt)],
        temperature=0.3,
    )

    result = chat(payload)
    return result.content
"""
Qwen LLM tasks.

SAMMA interface som OpenAI - drop-in replacement!
"""

from typing import Generator

from ..decorator import task

# Använder SAMMA schema som OpenAI
from ...schemas.chat import ChatPayload, ChatResponse, Message


@task(
    name="qwen.chat",
    tags=["text", "ai", "generate"],
    gpu="A10G",  # Qwen kör lokalt på GPU
    timeout=120,
)
def chat(payload: ChatPayload) -> ChatResponse:
    """
    Chat completion using Qwen (local GPU).

    Accepterar EXAKT samma payload som openai.chat!
    """
    # Konvertera till Qwen-format internt
    from transformers import AutoModelForCausalLM, AutoTokenizer

    model_name = "Qwen/Qwen2-7B-Instruct"
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForCausalLM.from_pretrained(model_name, device_map="auto")

    # Bygg prompt från messages
    prompt = _build_prompt(payload.messages)

    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    outputs = model.generate(
        **inputs,
        max_new_tokens=payload.max_tokens or 512,
        temperature=payload.temperature,
        do_sample=payload.temperature > 0,
    )

    response_text = tokenizer.decode(outputs[0], skip_special_tokens=True)

    return ChatResponse(
        content=response_text,
        model=model_name,
        usage={"total_tokens": len(outputs[0])},
    )


@task(
    name="qwen.chat_stream",
    tags=["text", "ai", "generate"],
    gpu="A10G",
    timeout=120,
    streaming=True,
)
def chat_stream(payload: ChatPayload) -> Generator[ChatResponse, None, None]:
    """Streaming chat with Qwen."""
    from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer
    from threading import Thread

    model_name = "Qwen/Qwen2-7B-Instruct"
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForCausalLM.from_pretrained(model_name, device_map="auto")

    prompt = _build_prompt(payload.messages)
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    streamer = TextIteratorStreamer(tokenizer, skip_special_tokens=True)

    thread = Thread(target=model.generate, kwargs={
        **inputs,
        "max_new_tokens": payload.max_tokens or 512,
        "streamer": streamer,
    })
    thread.start()

    for text in streamer:
        yield ChatResponse(
            content=text,
            model=model_name,
            is_partial=True,
        )


def _build_prompt(messages: list[Message]) -> str:
    """Convert standard messages to Qwen prompt format."""
    parts = []
    for msg in messages:
        if msg.role == "system":
            parts.append(f"<|im_start|>system\n{msg.content}<|im_end|>")
        elif msg.role == "user":
            parts.append(f"<|im_start|>user\n{msg.content}<|im_end|>")
        elif msg.role == "assistant":
            parts.append(f"<|im_start|>assistant\n{msg.content}<|im_end|>")
    parts.append("<|im_start|>assistant\n")
    return "\n".join(parts)
