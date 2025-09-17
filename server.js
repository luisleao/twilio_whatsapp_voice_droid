const express = require('express');
const http = require('http');
const WebSocket = require('ws');


require('dotenv').config();

const {
    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
    OPENAI_API_KEY,
    VOICE,
    WELCOME_GREETING,
    WELCOME_GREET_LANGUAGE,
    TRANSCRIPTION_LANGUAGE,
    INTERRUPTIBLE,
    DTMF_DETECTION,

} = process.env;

const {
    EVENT_NAME
} = process.env;


const twilio = require('twilio');

const { OpenAI } = require('openai');
const openai = new OpenAI({
    apiKey: OPENAI_API_KEY
});




const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let robotWs = null;
const sessions = new Map();

app.get('/', async (req, res) => {
    res.sendFile(__dirname + '/public/robot.html');
});

app.post('/callDefault', async (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Olá RogaDX!');
    res.send(twiml.toString());
});


app.post('/call', async (req, res) => {
    const host = req.headers['x-forwarded-host'];

    const twiml = new twilio.twiml.VoiceResponse();
    const connect = twiml.connect({
        action: `https://${host}/ended`
    });
    const conversationrelay = connect.conversationRelay({
        url: `wss://${host}/call`,
        welcomeGreeting: WELCOME_GREETING, //.split('{nome}').join('desconhecido'), 
        welcomeGreetingLanguage: WELCOME_GREET_LANGUAGE,
        transcriptionLanguage: TRANSCRIPTION_LANGUAGE,
        voice: VOICE,
        interruptible: INTERRUPTIBLE,
        dtmfDetection: DTMF_DETECTION,
    });

    // conversationrelay.parameter({
    //     name: 'foo',
    //     value: 'bar'
    // });
    
    res.type('text/xml');
    res.send(twiml.toString());

});

app.post('/ended', async (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    res.send(twiml.toString());
});

wss.on('connection', async (ws, req) => {
    // Pode receber chamada tanto do conversationrelay quando do websocket da página local

    switch(req.url) {
        case '/robot':
            // Receber nome do robô para saber em qual está conectando e permitir várias conexões simultâneas
            console.log('NEW ROBOT CONNECTION');
            ws.callSid = 'robot';
            ws.on('message', async (message) => {
                try {
                    const data = JSON.parse(message);
                    // Receber nome do robô e status de conexão
                    // console.log('RECEIVED MESSAGE', data);
                } catch (e) {
                    console.error('Invalid message received:', message);
                }
            });
            robotWs = ws;
            break;
        case '/call':
        // default:
            // Conversation Relay
            ws.on('message', async (data) => {

                console.log('NEW CONVERSATION RELAY CONNECTION');
                const message = JSON.parse(data);
                switch (message.type) {
                    case "setup":
                        const callSid = message.callSid;

                        ws.callSid = callSid;

                        console.log('');
                        console.log("Setup for call:", callSid);
                        console.log('CALL DATA', message);

                        // const contact = contacts.get(message.from);
                        // contact.ws = ws;
                        // contacts.set(message.from, contact);
                        // ws.contact = contact;
                        const SYSTEM_PROMPT = {
                            role: 'system',
                            content: [
                                // TODO: create system prompt with data
                                { 
                                    type: 'text', 
                                    text: `
                                        Você é um robô participando da RogaDX e funciona respondendo perguntas de sim ou não para participantes conectados a você por telefone.
                                        Quando você receber uma pergunta deve respondê-la no formato de comandos para o robô conectado por um websocket.
                                        Este robô você pode dar comandos para tocar sons individuais, sons em grupo ou acionar motores das pernas, conforme detalhamento a seguir.

                                        Envie apenas a sequência de comando que pode será um array de comandos que poderá ser comandos em hexadecimal conforme instruções a seguir ou um comando de delay em milissegundos, conforme exemplo:
                                        [
                                            "COMANDO HEX",
                                            "DELAY:<tempo em milissegundos - não pode ultrapassar 3000"
                                        ]
                                        Limite este vetor em até 10 items.
                                        Quando enviar um comando para controlar o motor, sempre envie no final um comando de desligamento de todos os motores e você pode ultrapassar o limite de 10 items no vetor caso seja necessário. Cara motor precisa ser desligado individualmente!

                                        Individual Sounds:
                                        2742 0F44 4400 1801 - inicio
                                        2742 0F44 4400 1007 - inicializacao

                                        Sound Groups:
                                        2742 0F44 4400 1000 - interrupcão
                                        2742 0F44 4400 1001 - não
                                        2742 0F44 4400 1002 - sim
                                        2742 0F44 4400 100A - lasers/blasters/som de tiro

                                        Mexer a Cabeça:
                                        2500 0C42 0102 - gira a cabeça como se estivesse negando alguma coisa
                                        2500 0C42 0202 - gira apenas a cabeça lentamente com som
                                        2500 0C42 0502 - gira apenas a cabeça lentamente com som
                                        2500 0C42 0802 - start geral do setup na loja
                                        2500 0C42 0902 - move as pernas em ambas as direções rapidamente por um momento
                                        2500 0C42 1002 - gira a cabeça sem som e depois inicializa

                                        Controle de motores dos pés:
                                        Considere abaixo o código para controlar o motor. Ele possui um parâmetro A, X e YY seguindo o padrão "2942 0546 AXYY 012C 0000"
                                        
                                        Este robô possui dois motores, um na perna esquerda e um na direita. Quando quiser mover completamente pra frente ou para trás você precisa acionar os dois motores. Para virar para um lado acione apenas um deles.
                                        A is the direction of the motor: 0 forward, 8 backward.
                                        X is the motor number: 0 for the first, 1 for the second or 2 for the third motor.
                                        YY is the power of the motor, from 00 (0%) to FF (100%)

                                         2942 0546 AXYY 012C 0000
                                        
                                        Perna da Esquerda: 
                                        "2942 0546 0000 012C 0000": motor desligado
                                        "2942 0546 0055 012C 0000": vai para frente
                                        "2942 0546 8055 012C 0000": volta para trás

                                        Perna da Direita: 
                                        "2942 0546 0100 012C 0000": motor desligado
                                        "2942 0546 0155 012C 0000": vai para frente
                                        "2942 0546 8155 012C 0000": volta para trás



                                        Para ir para frente completamente precisa acionar os dois motores simultaneamente
                                        Se acionar um para frente e outro para trás ele vira para um lado
                                        Quando precisar acionar os motores simultaneamente envie os códigos na sequência.
                                        Adicione o delay após comandos de áudio para que não sejam interrompidos se tiver um comando de áudio na sequência.
                                        O delay não pode ser maior que 5000 e sempre deve ser, pelo menos 1000 entre cada interação.
                                        Quando o comando for voltar para trás você deve acionar os dois motores das pernas para trás

                                        Em todo comando de movimento das pernas você sempre deve ao final adicionar comandos de parada de ambas as pernas, mesmo que adicione mais elementos no vetor além do limite.
                                    
                                    `


                                }
                            ]
                        };

                        sessions.set(callSid, [SYSTEM_PROMPT]);

                        let greeting = 'Olá! Agora você foi conectado e já pode fazer qualquer pergunta ou conversar com o erre dois dê dois!';

                        ws.send(
                            JSON.stringify({
                                type: "text",
                                token: greeting,
                                preemptible: true,
                                last: true,
                            })
                        );

                        break;

                    case "prompt":
                        console.log("Processing prompt:", message.voicePrompt);
                        const conversation = sessions.get(ws.callSid);
                        conversation.push({ role: "user", content: message.voicePrompt });

                        console.log('conversation', conversation);

                        const response = await openai.chat.completions.create({
                            model: 'gpt-4o-mini',
                            // response_format: { "type": "json_object" },
                            messages: [
                                ...conversation
                            ],
                            // max_tokens: 100
                        });
                        const resposta = response.choices[0].message.content;

                        // contact.messages.push({
                        //     role: 'assistant',
                        //     content: [
                        //         { type: 'text', text: resposta}
                        //     ]
                        // });
                        conversation.push(response.choices[0].message);
                        sessions.set(ws.callSid, conversation);

                        console.log('RESPOSTA:', resposta);

                        // Enviar resposta para websocket de robo
                        if (!robotWs) {
                            console.log('Nenhum websocket de robô conectado!');
                            return;
                        }

                        // Envio do comando do robo
                        wss.clients.forEach(client => {
                            if (client.callSid == 'robot' && client.readyState === WebSocket.OPEN) {
                                client.send(resposta);
                            }
                        });

                        break;

                    case "interrupt":
                        console.log("Handling interruption.");
                        break;

                    default:
                        console.warn("Unknown message type received:", message.type);
                        break;
                }
            });
    }


});




server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});




function broadcastMessage(message) {
    console.log('BROADCASTING...', message)
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}