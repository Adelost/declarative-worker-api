"""
Image tasks - generate, edit, describe.
Pure Python implementations.
"""

from typing import Optional
import base64
from pathlib import Path


def generate(
    prompt: str,
    model: str = "dall-e-3",
    size: str = "1024x1024",
    quality: str = "standard",
    style: str = "vivid",
) -> str:
    """
    Generate image using DALL-E.

    Args:
        prompt: Image description
        model: Model to use (dall-e-2, dall-e-3)
        size: Image size (1024x1024, 1792x1024, 1024x1792)
        quality: Image quality (standard, hd)
        style: Image style (vivid, natural)

    Returns:
        URL to generated image
    """
    import openai

    response = openai.images.generate(
        model=model,
        prompt=prompt,
        size=size,
        quality=quality,
        style=style,
        n=1,
    )

    return response.data[0].url


def generate_sd(
    prompt: str,
    negative_prompt: str = "",
    steps: int = 30,
    guidance_scale: float = 7.5,
    width: int = 512,
    height: int = 512,
    model_id: str = "runwayml/stable-diffusion-v1-5",
    output_path: Optional[str] = None,
) -> str:
    """
    Generate image using Stable Diffusion.
    Requires GPU.

    Args:
        prompt: Image description
        negative_prompt: What to avoid
        steps: Number of inference steps
        guidance_scale: Classifier-free guidance scale
        width: Image width
        height: Image height
        model_id: Hugging Face model ID
        output_path: Optional output path

    Returns:
        Path to generated image
    """
    from diffusers import StableDiffusionPipeline
    import torch

    pipe = StableDiffusionPipeline.from_pretrained(
        model_id,
        torch_dtype=torch.float16,
    ).to("cuda")

    image = pipe(
        prompt,
        negative_prompt=negative_prompt,
        num_inference_steps=steps,
        guidance_scale=guidance_scale,
        width=width,
        height=height,
    ).images[0]

    if output_path is None:
        output_path = f"/tmp/sd_{hash(prompt) % 10000}.png"

    image.save(output_path)
    return output_path


def generate_sdxl(
    prompt: str,
    negative_prompt: str = "",
    steps: int = 40,
    guidance_scale: float = 7.0,
    width: int = 1024,
    height: int = 1024,
    output_path: Optional[str] = None,
) -> str:
    """
    Generate image using Stable Diffusion XL.
    Requires GPU with >= 10GB VRAM.

    Args:
        prompt: Image description
        negative_prompt: What to avoid
        steps: Number of inference steps
        guidance_scale: Classifier-free guidance scale
        width: Image width
        height: Image height
        output_path: Optional output path

    Returns:
        Path to generated image
    """
    from diffusers import StableDiffusionXLPipeline
    import torch

    pipe = StableDiffusionXLPipeline.from_pretrained(
        "stabilityai/stable-diffusion-xl-base-1.0",
        torch_dtype=torch.float16,
        variant="fp16",
    ).to("cuda")

    image = pipe(
        prompt,
        negative_prompt=negative_prompt,
        num_inference_steps=steps,
        guidance_scale=guidance_scale,
        width=width,
        height=height,
    ).images[0]

    if output_path is None:
        output_path = f"/tmp/sdxl_{hash(prompt) % 10000}.png"

    image.save(output_path)
    return output_path


def describe(
    image_path: str,
    prompt: str = "Describe this image in detail.",
    model: str = "gpt-4o",
) -> str:
    """
    Describe image using GPT-4 Vision.

    Args:
        image_path: Path to image file
        prompt: Question or instruction about the image
        model: Vision model to use

    Returns:
        Description text
    """
    import openai

    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    # Detect MIME type from extension
    ext = Path(image_path).suffix.lower()
    mime_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }
    mime = mime_types.get(ext, "image/png")

    response = openai.chat.completions.create(
        model=model,
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64}"}
                }
            ]
        }],
        max_tokens=1000,
    )

    return response.choices[0].message.content


def edit(
    image_path: str,
    prompt: str,
    mask_path: Optional[str] = None,
    model: str = "dall-e-2",
    size: str = "1024x1024",
) -> str:
    """
    Edit image using DALL-E.

    Args:
        image_path: Path to original image
        prompt: Edit instructions
        mask_path: Optional mask image (transparent areas will be edited)
        model: Model to use
        size: Output size

    Returns:
        URL to edited image
    """
    import openai

    with open(image_path, "rb") as img:
        kwargs = {
            "model": model,
            "image": img,
            "prompt": prompt,
            "size": size,
            "n": 1,
        }

        if mask_path:
            with open(mask_path, "rb") as mask:
                kwargs["mask"] = mask
                response = openai.images.edit(**kwargs)
        else:
            response = openai.images.edit(**kwargs)

    return response.data[0].url
