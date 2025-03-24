import { createClient, ClientOptions } from "bedrock-protocol";


let options: ClientOptions;

//@ts-ignore
options = {
    host: "51.79.62.8",
    port: 19132,
    offline: false,
    viewDistance: 8,
    authTitle: '000000004c17c01a',
    profilesFolder: "authentication_tokens",
    flow: "msal"
} as ClientOptions;

const bot = createClient(options);

bot.on('join', (packet: any) => {
    console.log('Client got text packet', JSON.stringify(packet))
})
