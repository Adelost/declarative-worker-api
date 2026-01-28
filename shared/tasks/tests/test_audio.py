"""
Unit tests for audio tasks.
Uses mocking to avoid actual API calls.
"""

import pytest
from unittest.mock import patch, MagicMock, mock_open


class TestTranscribe:
    """Tests for audio.transcribe function."""

    @patch("builtins.open", mock_open(read_data=b"audio data"))
    @patch("openai.audio.transcriptions.create")
    def test_transcribe_basic(self, mock_create):
        """Test basic transcription."""
        from tasks.audio import transcribe

        mock_response = MagicMock()
        mock_response.text = "Hello, this is a test."
        mock_create.return_value = mock_response

        result = transcribe("/path/to/audio.mp3")

        assert result == "Hello, this is a test."
        mock_create.assert_called_once()

    @patch("builtins.open", mock_open(read_data=b"audio data"))
    @patch("openai.audio.transcriptions.create")
    def test_transcribe_with_language(self, mock_create):
        """Test transcription with language hint."""
        from tasks.audio import transcribe

        mock_response = MagicMock()
        mock_response.text = "Bonjour"
        mock_create.return_value = mock_response

        result = transcribe("/path/to/audio.mp3", language="fr")

        call_args = mock_create.call_args
        assert call_args.kwargs.get("language") == "fr"


class TestTts:
    """Tests for audio.tts function."""

    @patch("openai.audio.speech.create")
    def test_tts_basic(self, mock_create):
        """Test basic text-to-speech."""
        from tasks.audio import tts

        mock_response = MagicMock()
        mock_response.stream_to_file = MagicMock()
        mock_create.return_value = mock_response

        result = tts("Hello, world!")

        assert result == "output.mp3"
        mock_create.assert_called_once_with(
            model="tts-1",
            voice="alloy",
            input="Hello, world!",
            speed=1.0,
        )
        mock_response.stream_to_file.assert_called_once_with("output.mp3")

    @patch("openai.audio.speech.create")
    def test_tts_custom_voice(self, mock_create):
        """Test TTS with custom voice."""
        from tasks.audio import tts

        mock_response = MagicMock()
        mock_response.stream_to_file = MagicMock()
        mock_create.return_value = mock_response

        result = tts("Hello", voice="nova", output_path="/tmp/speech.mp3")

        assert result == "/tmp/speech.mp3"
        call_args = mock_create.call_args
        assert call_args.kwargs["voice"] == "nova"

    @patch("openai.audio.speech.create")
    def test_tts_hd_model(self, mock_create):
        """Test TTS with HD model."""
        from tasks.audio import tts

        mock_response = MagicMock()
        mock_response.stream_to_file = MagicMock()
        mock_create.return_value = mock_response

        tts("Hello", model="tts-1-hd")

        call_args = mock_create.call_args
        assert call_args.kwargs["model"] == "tts-1-hd"
