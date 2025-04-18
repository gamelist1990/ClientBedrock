import asyncio
import os
from Module.g4f.client import Client
from Module.g4f.Provider import Gemini,HuggingChat
import Module.g4f.models
import Module.g4f.debug
from Module.g4f.cookies import set_cookies_dir, read_cookie_files


Module.g4f.debug.logging = True
cookies_dir = os.path.join(os.path.dirname(__file__), "har_and_cookies")
set_cookies_dir(cookies_dir)
read_cookie_files(cookies_dir)

def main() -> None:
    """Main entry point for the program."""
    client = Client(provider=HuggingChat)
    model_name = Module.g4f.models.command_r_plus
    prompt = " "

    response = client.chat.completions.create(
        model=model_name, messages=[{"role": "user", "content": prompt}]
    )

    ai_response = response.choices[0].message.content
    print(ai_response)

main()
