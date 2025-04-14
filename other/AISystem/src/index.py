import asyncio
import os
from Module.g4f.client import Client
from Module.g4f.Provider import Gemini
import Module.g4f.debug
from Module.g4f.cookies import set_cookies_dir, read_cookie_files


Module.g4f.debug.logging = True
cookies_dir = os.path.join(os.path.dirname(__file__), "har_and_cookies")
set_cookies_dir(cookies_dir)
read_cookie_files(cookies_dir)

def main():
    client = Client(
        provider=Gemini
    )
    response = client.chat.completions.create(
        model=Module.g4f.models.gemini_2_0_flash,
        messages=[{"role": "user", "content": "こんにちは！今話題のXについて教えてください。！！"}],
    )
    
    print(response.choices[0].message.content)

main()