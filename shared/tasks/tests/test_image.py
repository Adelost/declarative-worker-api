"""
Unit tests for image tasks.
Uses mocking to avoid actual API calls.
"""

import pytest
from unittest.mock import patch, MagicMock, mock_open


class TestGenerate:
    """Tests for image.generate function."""

    @patch("openai.images.generate")
    def test_generate_basic(self, mock_generate):
        """Test basic image generation."""
        from tasks.image import generate

        mock_response = MagicMock()
        mock_response.data = [MagicMock()]
        mock_response.data[0].url = "https://cdn.example.com/image.png"
        mock_generate.return_value = mock_response

        result = generate("A beautiful sunset")

        assert result == "https://cdn.example.com/image.png"
        mock_generate.assert_called_once_with(
            model="dall-e-3",
            prompt="A beautiful sunset",
            size="1024x1024",
            quality="standard",
            style="vivid",
            n=1,
        )

    @patch("openai.images.generate")
    def test_generate_custom_params(self, mock_generate):
        """Test image generation with custom parameters."""
        from tasks.image import generate

        mock_response = MagicMock()
        mock_response.data = [MagicMock()]
        mock_response.data[0].url = "https://cdn.example.com/image.png"
        mock_generate.return_value = mock_response

        generate(
            "A cat",
            model="dall-e-2",
            size="512x512",
            quality="hd",
            style="natural",
        )

        call_args = mock_generate.call_args
        assert call_args.kwargs["model"] == "dall-e-2"
        assert call_args.kwargs["size"] == "512x512"
        assert call_args.kwargs["quality"] == "hd"
        assert call_args.kwargs["style"] == "natural"


class TestDescribe:
    """Tests for image.describe function."""

    @patch("builtins.open", mock_open(read_data=b"fake image data"))
    @patch("openai.chat.completions.create")
    def test_describe_basic(self, mock_create):
        """Test basic image description."""
        from tasks.image import describe

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "A photo of a cat."
        mock_create.return_value = mock_response

        result = describe("/path/to/image.png")

        assert result == "A photo of a cat."
        mock_create.assert_called_once()

        # Verify vision message format
        call_args = mock_create.call_args
        message = call_args.kwargs["messages"][0]
        assert message["role"] == "user"
        assert len(message["content"]) == 2
        assert message["content"][0]["type"] == "text"
        assert message["content"][1]["type"] == "image_url"

    @patch("builtins.open", mock_open(read_data=b"fake image data"))
    @patch("openai.chat.completions.create")
    def test_describe_custom_prompt(self, mock_create):
        """Test image description with custom prompt."""
        from tasks.image import describe

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "A dog and a cat"
        mock_create.return_value = mock_response

        result = describe("/path/to/image.jpg", prompt="Count the animals")

        call_args = mock_create.call_args
        text_content = call_args.kwargs["messages"][0]["content"][0]
        assert text_content["text"] == "Count the animals"


class TestEdit:
    """Tests for image.edit function."""

    @patch("builtins.open", mock_open(read_data=b"fake image data"))
    @patch("openai.images.edit")
    def test_edit_basic(self, mock_edit):
        """Test basic image editing."""
        from tasks.image import edit

        mock_response = MagicMock()
        mock_response.data = [MagicMock()]
        mock_response.data[0].url = "https://cdn.example.com/edited.png"
        mock_edit.return_value = mock_response

        result = edit("/path/to/image.png", "Add a hat")

        assert result == "https://cdn.example.com/edited.png"


class TestGenerateSd:
    """Tests for image.generate_sd function (Stable Diffusion)."""

    @pytest.mark.skip(reason="Requires GPU and heavy dependencies")
    def test_generate_sd_basic(self):
        """Test SD image generation (skip in CI)."""
        pass
