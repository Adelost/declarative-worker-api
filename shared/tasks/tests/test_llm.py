"""
Unit tests for LLM tasks.
Uses mocking to avoid actual API calls.
"""

import pytest
from unittest.mock import patch, MagicMock


class TestChat:
    """Tests for llm.chat function."""

    @patch("openai.chat.completions.create")
    def test_chat_basic(self, mock_create):
        """Test basic chat completion."""
        from tasks.llm import chat

        # Mock response
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "Hello! How can I help you?"
        mock_create.return_value = mock_response

        result = chat("Hello")

        assert result == "Hello! How can I help you?"
        mock_create.assert_called_once()

        # Verify the call
        call_args = mock_create.call_args
        assert call_args.kwargs["model"] == "gpt-4"
        assert call_args.kwargs["messages"][0]["role"] == "user"
        assert call_args.kwargs["messages"][0]["content"] == "Hello"

    @patch("openai.chat.completions.create")
    def test_chat_with_system_message(self, mock_create):
        """Test chat with system message."""
        from tasks.llm import chat

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "Response"
        mock_create.return_value = mock_response

        chat("Hello", system="You are a helpful assistant")

        call_args = mock_create.call_args
        messages = call_args.kwargs["messages"]
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert messages[0]["content"] == "You are a helpful assistant"

    @patch("openai.chat.completions.create")
    def test_chat_with_custom_model(self, mock_create):
        """Test chat with custom model."""
        from tasks.llm import chat

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "Response"
        mock_create.return_value = mock_response

        chat("Hello", model="gpt-3.5-turbo")

        call_args = mock_create.call_args
        assert call_args.kwargs["model"] == "gpt-3.5-turbo"


class TestEmbed:
    """Tests for llm.embed function."""

    @patch("openai.embeddings.create")
    def test_embed_single_text(self, mock_create):
        """Test embedding single text."""
        from tasks.llm import embed

        mock_response = MagicMock()
        mock_response.data = [MagicMock()]
        mock_response.data[0].embedding = [0.1] * 1536
        mock_create.return_value = mock_response

        result = embed("Hello world")

        assert len(result) == 1536
        mock_create.assert_called_once_with(
            model="text-embedding-3-small",
            input="Hello world",
        )

    @patch("openai.embeddings.create")
    def test_embed_multiple_texts(self, mock_create):
        """Test embedding multiple texts."""
        from tasks.llm import embed

        mock_response = MagicMock()
        mock_response.data = [
            MagicMock(embedding=[0.1] * 1536),
            MagicMock(embedding=[0.2] * 1536),
        ]
        mock_create.return_value = mock_response

        result = embed(["Text 1", "Text 2"])

        assert len(result) == 2
        assert len(result[0]) == 1536


class TestSummarize:
    """Tests for llm.summarize function."""

    @patch("tasks.llm.chat")
    def test_summarize_concise(self, mock_chat):
        """Test concise summarization."""
        from tasks.llm import summarize

        mock_chat.return_value = "Short summary"

        result = summarize("Long text here", max_length=100, style="concise")

        assert result == "Short summary"
        mock_chat.assert_called_once()

        # Verify prompt mentions length
        call_args = mock_chat.call_args
        assert "100" in call_args.args[0]

    @patch("tasks.llm.chat")
    def test_summarize_bullet(self, mock_chat):
        """Test bullet point summarization."""
        from tasks.llm import summarize

        mock_chat.return_value = "• Point 1\n• Point 2"

        result = summarize("Long text", style="bullet")

        assert "Point 1" in result

        # Verify bullet style prompt
        call_args = mock_chat.call_args
        assert "bullet" in call_args.args[0].lower()


class TestExtract:
    """Tests for llm.extract function."""

    @patch("tasks.llm.chat")
    def test_extract_structured_data(self, mock_chat):
        """Test structured data extraction."""
        from tasks.llm import extract

        mock_chat.return_value = '{"name": "John", "age": 30}'

        schema = {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "age": {"type": "integer"},
            },
        }

        result = extract("My name is John and I am 30 years old.", schema)

        assert result == {"name": "John", "age": 30}
